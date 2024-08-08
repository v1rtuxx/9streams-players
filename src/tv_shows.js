const express = require('express');
const axios = require('axios');
const router = express.Router();

// Your TMDB API Key
const TMDB_API_KEY = 'dbd7e727fd4517c492d285d21c3d7da0';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 200; // Delay in milliseconds

// Helper function to fetch data with retry logic and timeout
const fetchDataWithRetry = async (url, attempts, delay) => {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await axios.get(url, { timeout: 10000 }); // 10 seconds timeout
            if (response.status === 200) {
                return response.data;
            }
        } catch (error) {
            console.error(`Request failed (attempt ${i + 1}/${attempts}): ${error.message}`);
            if (i < attempts - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    return null;
};

router.get('/fetch_tv_show_data', async (req, res) => {
    const tmdbId = req.query.tmdb_id;
    const seasonNumber = req.query.s;
    const episodeNumber = req.query.e;

    if (!tmdbId || !seasonNumber || !episodeNumber) {
        return res.status(400).json({ error: 'tmdb_id, s (season), and e (episode) parameters are required.' });
    }

    try {
        const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbData = await fetchDataWithRetry(tmdbUrl, RETRY_ATTEMPTS, RETRY_DELAY);
        if (!tmdbData) {
            return res.status(500).json({ error: 'Failed to fetch data from TMDB API.' });
        }

        const tvShowTitle = tmdbData.name;
        const tvShowSeasons = tmdbData.number_of_seasons;
        const encodedTitle = encodeURIComponent(tvShowTitle);
        const nineStreamsUrl = `https://9streams-consumet.vercel.app/movies/flixhq/${encodedTitle}?page=1`;

        const nineStreamsData = await fetchDataWithRetry(nineStreamsUrl, RETRY_ATTEMPTS, RETRY_DELAY);
        if (!nineStreamsData) {
            return res.status(500).json({ error: 'Failed to fetch data from 9streams API.' });
        }

        const matchingShow = nineStreamsData.results.find(result =>
            result.type === 'TV Series' &&
            result.title === tvShowTitle &&
            result.seasons == tvShowSeasons
        );

        if (!matchingShow) {
            return res.status(404).json({ error: 'No matching TV show found.' });
        }

        const showInfoUrl = `https://9streams-consumet.vercel.app/movies/flixhq/info?id=${matchingShow.id}`;
        const showInfoData = await fetchDataWithRetry(showInfoUrl, RETRY_ATTEMPTS, RETRY_DELAY);
        if (!showInfoData) {
            return res.status(500).json({ error: 'Failed to fetch show details from 9streams API.' });
        }

        const episode = showInfoData.episodes.find(ep =>
            ep.season == seasonNumber && ep.number == episodeNumber
        );

        if (!episode) {
            return res.status(404).json({ error: 'No matching episode found.' });
        }

        const watchUrl = `https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId=${episode.id}&mediaId=${matchingShow.id}&server=upcloud`;
        const watchData = await fetchDataWithRetry(watchUrl, RETRY_ATTEMPTS, RETRY_DELAY);
        if (!watchData) {
            return res.status(500).json({ error: 'Failed to fetch streaming URL from 9streams API.' });
        }

        watchData.episode_title = episode.title;
        res.json(watchData);
    } catch (error) {
        console.error(`Unexpected error: ${error.message}`);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

module.exports = router;

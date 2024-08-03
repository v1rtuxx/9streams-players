const express = require('express');
const axios = require('axios');
const router = express.Router();

// Your TMDB API Key
const TMDB_API_KEY = 'dbd7e727fd4517c492d285d21c3d7da0';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 200; // Delay in milliseconds

const fetchDataWithRetry = async (url, attempts, delay) => {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await axios.get(url);
            if (response.status === 200) {
                return response.data;
            }
        } catch (error) {
            console.error(`Request failed: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
};

router.get('/fetch_tv_show_data', async (req, res) => {
    const tmdbId = req.query.tmdb_id;
    const seasonNumber = req.query.s;
    const episodeNumber = req.query.e;

    if (!tmdbId || !seasonNumber || !episodeNumber) {
        return res.json({ error: 'tmdb_id, s (season), and e (episode) parameters are required.' });
    }

    const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbData = await fetchDataWithRetry(tmdbUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!tmdbData) {
        return res.json({ error: 'Failed to fetch data from TMDB API.' });
    }

    const tvShowTitle = tmdbData.name;
    const tvShowSeasons = tmdbData.number_of_seasons;

    const encodedTitle = encodeURIComponent(tvShowTitle);
    const nineStreamsUrl = `https://9streams-consumet.vercel.app/movies/flixhq/${encodedTitle}?page=1`;
    const nineStreamsData = await fetchDataWithRetry(nineStreamsUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!nineStreamsData) {
        return res.json({ error: 'Failed to fetch data from 9streams API.' });
    }

    if (!nineStreamsData.results) {
        return res.json({ error: 'No results found from 9streams API.' });
    }

    const matchingShow = nineStreamsData.results.find(result =>
        result.type === 'TV Series' &&
        result.title === tvShowTitle &&
        result.seasons == tvShowSeasons
    );

    if (!matchingShow) {
        return res.json({ error: 'No matching TV show found.' });
    }

    const showInfoUrl = `https://9streams-consumet.vercel.app/movies/flixhq/info?id=${matchingShow.id}`;
    const showInfoData = await fetchDataWithRetry(showInfoUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!showInfoData) {
        return res.json({ error: 'Failed to fetch show details from 9streams API.' });
    }

    const episode = showInfoData.episodes.find(ep =>
        ep.season == seasonNumber && ep.number == episodeNumber
    );

    if (!episode) {
        return res.json({ error: 'No matching episode found.' });
    }

    const watchUrl = `https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId=${episode.id}&mediaId=${matchingShow.id}&server=upcloud`;
    const watchData = await fetchDataWithRetry(watchUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!watchData) {
        return res.json({ error: 'Failed to fetch streaming URL from 9streams API.' });
    }

    watchData.episode_title = episode.title;
    res.json(watchData);
});

module.exports = router;

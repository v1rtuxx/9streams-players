const express = require('express');
const axios = require('axios');
const tvShowsRouter = require('./tv_shows');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Your TMDB API Key
const TMDB_API_KEY = 'dbd7e727fd4517c492d285d21c3d7da0';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 200; // Delay in milliseconds

// Allowed domains for CORS
const ALLOWED_DOMAINS = ['9streams.xyz', 'flixcloud.co'];

// Helper function to check if the request is from an allowed domain
const isAllowedDomain = (req) => {
    const referer = req.get('Referer');
    const origin = req.get('Origin');
    if (referer) {
        const refererDomain = new URL(referer).hostname;
        return ALLOWED_DOMAINS.includes(refererDomain);
    }
    if (origin) {
        const originDomain = new URL(origin).hostname;
        return ALLOWED_DOMAINS.includes(originDomain);
    }
    // If no referer or origin, deny access
    return false;
};

// Middleware to handle CORS for specific endpoints
const allowCors = (fn) => async (req, res) => {
    if (req.path.startsWith('/skiptimes')) {
        // Allow CORS for the /skiptimes endpoint
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        return await fn(req, res);
    } else {
        // Restrict CORS for other endpoints
        if (!isAllowedDomain(req)) {
            return res.status(403).json({ error: 'Forbidden: Access is denied.' });
        }

        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', req.get('Origin') || '*'); // Allow specific origins
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
        res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }
        return await fn(req, res);
    }
};

// Fetch data with retry logic
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

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Use the TV shows router
app.use('/tv_shows', allowCors(tvShowsRouter));

// Root route
app.get('/', allowCors((req, res) => {
    res.json({ message: 'Your API is ready!' });
}));

// New endpoint to get skiptimes in VTT format
app.get('/skiptimes/:episodeId.vtt', allowCors(async (req, res) => {
    const { episodeId } = req.params;
    const apiUrl = `https://zoro-api-9streams.vercel.app/api/v2/hianime/episode/sources?animeEpisodeId=${episodeId}&server=hd-1&category=dub`;

    // Fetch data from the API
    const apiData = await fetchDataWithRetry(apiUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!apiData) {
        return res.status(500).json({ error: 'Failed to fetch data from Zoro API' });
    }

    // Check if the API response is successful and contains the necessary data
    if (!apiData.success || !apiData.data) {
        return res.status(404).json({ error: 'Invalid API response' });
    }

    // Extract intro and outro times from the new response format
    const { intro, outro } = apiData.data;
    if (!intro || !outro) {
        return res.status(404).json({ error: 'Intro or Outro times not found' });
    }

    // Convert intro and outro times to VTT format
    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const vttContent = `WEBVTT

${formatTime(intro.start)} --> ${formatTime(intro.end)}
Opening

${formatTime(outro.start)} --> ${formatTime(outro.end)}
Outro
`;

    // Set the response headers for VTT file
    res.setHeader('Content-Type', 'text/vtt');
    res.send(vttContent);
}));
// Endpoint to fetch movie data
app.get('/fetch_movie_data', allowCors(async (req, res) => {
    const tmdbId = req.query.tmdb_id;
    if (!tmdbId) {
        return res.status(400).json({ error: 'tmdb_id parameter is missing' });
    }

    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const tmdbData = await fetchDataWithRetry(tmdbUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!tmdbData) {
        return res.status(500).json({ error: 'Failed to fetch data from TMDB API' });
    }

    if (tmdbData.status_code) {
        return res.status(400).json({ error: 'Invalid TMDB ID or API Key' });
    }

    const movieTitle = tmdbData.title;
    const releaseYear = tmdbData.release_date.split('-')[0];
    const encodedTitle = encodeURIComponent(movieTitle);
    const streamUrl = `https://9streams-consumet.vercel.app/movies/flixhq/${encodedTitle}?page=1`;
    const streamData = await fetchDataWithRetry(streamUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!streamData) {
        return res.status(500).json({ error: 'Failed to fetch data from 9streams API' });
    }

    if (!streamData.results) {
        return res.status(404).json({ error: 'No results found from 9streams API' });
    }

    const correctMovie = streamData.results.find(result =>
        result.type === 'Movie' && result.title === movieTitle && result.releaseDate === releaseYear
    );

    if (correctMovie) {
        const movieId = correctMovie.id;
        const episodeIdMatch = movieId.match(/\/watch-(.*?)-(\d+)$/);
        if (episodeIdMatch) {
            const episodeId = episodeIdMatch[2];
            const watchUrl = `https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId=${episodeId}&mediaId=${movieId}&server=upcloud`;
            const watchData = await fetchDataWithRetry(watchUrl, RETRY_ATTEMPTS, RETRY_DELAY);
            if (!watchData) {
                return res.status(500).json({ error: 'Failed to fetch data from the watch API' });
            }

            const infoUrl = `https://9streams-consumet.vercel.app/movies/flixhq/info?id=${movieId}`;
            const infoData = await fetchDataWithRetry(infoUrl, RETRY_ATTEMPTS, RETRY_DELAY);
            if (!infoData) {
                return res.status(500).json({ error: 'Failed to fetch data from the info API' });
            }

            if (infoData.title && infoData.cover) {
                watchData.info = {
                    title: infoData.title,
                    cover: infoData.cover
                };
                return res.json(watchData);
            } else {
                return res.status(404).json({ error: 'No additional info found for the movie' });
            }
        } else {
            return res.status(400).json({ error: 'Failed to extract episodeId from movie ID' });
        }
    } else {
        return res.status(404).json({ error: 'No matching movie found' });
    }
}));

// Endpoint to fetch data from TMDB based on path
app.get('/tmdb/*', allowCors(async (req, res) => {
    const path = req.params[0]; // Extract the path after '/tmdb/'
    const tmdbUrl = `https://api.themoviedb.org/3/${path}?api_key=${TMDB_API_KEY}`;

    const tmdbData = await fetchDataWithRetry(tmdbUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!tmdbData) {
        return res.status(500).json({ error: 'Failed to fetch data from TMDB API' });
    }

    return res.json(tmdbData);
}));

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

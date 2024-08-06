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

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Uncomment the following line to allow only specific origins
  // res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

const fetchDataWithRetry = async (url, attempts, delay) => {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await axios.get(url);
            if (response.status === 200) {
                return response.data;
            }
        } catch (error) {
            console.error(Request failed: ${error.message});
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
};

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

app.use('/tv_shows', allowCors(tvShowsRouter));

app.get('/', allowCors((req, res) => {
    res.json({ message: 'Your API is ready!' });
}));

app.get('/fetch_movie_data', allowCors(async (req, res) => {
    const tmdbId = req.query.tmdb_id;
    if (!tmdbId) {
        return res.json({ error: 'tmdb_id parameter is missing' });
    }

    const tmdbUrl = https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY};
    const tmdbData = await fetchDataWithRetry(tmdbUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!tmdbData) {
        return res.json({ error: 'Failed to fetch data from TMDB API' });
    }

    if (tmdbData.status_code) {
        return res.json({ error: 'Invalid TMDB ID or API Key' });
    }

    const movieTitle = tmdbData.title;
    const releaseYear = tmdbData.release_date.split('-')[0];

    const encodedTitle = encodeURIComponent(movieTitle);
    const streamUrl = https://9streams-consumet.vercel.app/movies/flixhq/${encodedTitle}?page=1;
    const streamData = await fetchDataWithRetry(streamUrl, RETRY_ATTEMPTS, RETRY_DELAY);
    if (!streamData) {
        return res.json({ error: 'Failed to fetch data from 9streams API' });
    }

    if (!streamData.results) {
        return res.json({ error: 'No results found from 9streams API' });
    }

    const correctMovie = streamData.results.find(result =>
        result.type === 'Movie' && result.title === movieTitle && result.releaseDate === releaseYear
    );

    if (correctMovie) {
        const movieId = correctMovie.id;
        const episodeIdMatch = movieId.match(/\/watch-(.*?)-(\d+)$/);
        if (episodeIdMatch) {
            const episodeId = episodeIdMatch[2];
            const watchUrl = https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId=${episodeId}&mediaId=${movieId}&server=upcloud;
            const watchData = await fetchDataWithRetry(watchUrl, RETRY_ATTEMPTS, RETRY_DELAY);
            if (!watchData) {
                return res.json({ error: 'Failed to fetch data from the watch API' });
            }

            const infoUrl = https://9streams-consumet.vercel.app/movies/flixhq/info?id=${movieId};
            const infoData = await fetchDataWithRetry(infoUrl, RETRY_ATTEMPTS, RETRY_DELAY);
            if (!infoData) {
                return res.json({ error: 'Failed to fetch data from the info API' });
            }

            if (infoData.title && infoData.cover) {
                watchData.info = {
                    title: infoData.title,
                    cover: infoData.cover
                };
                return res.json(watchData);
            } else {
                return res.json({ error: 'No additional info found for the movie' });
            }
        } else {
            return res.json({ error: 'Failed to extract episodeId from movie ID' });
        }
    } else {
        return res.json({ error: 'No matching movie found' });
    }
}));

app.listen(PORT, () => {
    console.log(Server is running on port ${PORT});
});

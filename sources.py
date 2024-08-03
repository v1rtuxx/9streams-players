import json
import time
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# Your TMDB API Key
TMDB_API_KEY = "dbd7e727fd4517c492d285d21c3d7da0"

# Number of retry attempts
RETRY_ATTEMPTS = 3
RETRY_DELAY = 0.2  # Delay in seconds between retries


def fetch_data_with_retry(url, attempts, delay):
    response = None
    for _ in range(attempts):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                return response.text
        except requests.RequestException:
            time.sleep(delay)
    return None


@app.route('/fetch_movie_data', methods=['GET'])
def fetch_movie_data():
    # Get the tmdb_id parameter from the URL
    tmdb_id = request.args.get('tmdb_id')
    if not tmdb_id:
        return jsonify({"error": "tmdb_id parameter is missing"})

    # Fetch the movie details from TMDB API
    tmdb_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={TMDB_API_KEY}"
    tmdb_response = fetch_data_with_retry(tmdb_url, RETRY_ATTEMPTS, RETRY_DELAY)
    if not tmdb_response:
        return jsonify({"error": "Failed to fetch data from TMDB API"})

    tmdb_data = json.loads(tmdb_response)
    if 'status_code' in tmdb_data:
        return jsonify({"error": "Invalid TMDB ID or API Key"})

    movie_title = tmdb_data.get('title')
    release_year = tmdb_data.get('release_date', '').split('-')[0]

    # Fetch the results from 9streams API
    encoded_title = requests.utils.quote(movie_title)
    stream_url = f"https://9streams-consumet.vercel.app/movies/flixhq/{encoded_title}?page=1"
    stream_response = fetch_data_with_retry(stream_url, RETRY_ATTEMPTS, RETRY_DELAY)
    if not stream_response:
        return jsonify({"error": "Failed to fetch data from 9streams API"})

    stream_data = json.loads(stream_response)
    if 'results' not in stream_data:
        return jsonify({"error": "No results found from 9streams API"})

    # Filter results to find the correct movie
    correct_movie = next((result for result in stream_data['results'] 
                          if result['type'] == 'Movie' and result['title'] == movie_title 
                          and result['releaseDate'] == release_year), None)

    if correct_movie:
        movie_id = correct_movie['id']

        # Extract episodeId from the movie_id
        import re
        match = re.search(r'/watch-(.*?)-(\d+)$', movie_id)
        if match:
            episode_id = match.group(2)
        else:
            return jsonify({"error": "Failed to extract episodeId from movie ID"})

        # Fetch additional details from 9streams API
        watch_url = f"https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId={episode_id}&mediaId={movie_id}&server=upcloud"
        watch_response = fetch_data_with_retry(watch_url, RETRY_ATTEMPTS, RETRY_DELAY)
        if not watch_response:
            return jsonify({"error": "Failed to fetch data from the watch API"})

        # Fetch movie info from 9streams API
        info_url = f"https://9streams-consumet.vercel.app/movies/flixhq/info?id={movie_id}"
        info_response = fetch_data_with_retry(info_url, RETRY_ATTEMPTS, RETRY_DELAY)
        if not info_response:
            return jsonify({"error": "Failed to fetch data from the info API"})

        info_data = json.loads(info_response)
        if 'title' in info_data and 'cover' in info_data:
            watch_data = json.loads(watch_response)
            watch_data['info'] = {
                'title': info_data['title'],
                'cover': info_data['cover']
            }
            return jsonify(watch_data)
        else:
            return jsonify({"error": "No additional info found for the movie"})
    else:
        return jsonify({"error": "No matching movie found"})


if __name__ == '__main__':
    app.run(debug=True)

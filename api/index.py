import json
import requests
import time
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

# Your TMDB API Key
TMDB_API_KEY = "dbd7e727fd4517c492d285d21c3d7da0"
RETRY_ATTEMPTS = 3
RETRY_DELAY = 0.2

def fetch_data_with_retry(url, attempts, delay):
    response = None
    for _ in range(attempts):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                return response.text
        except requests.RequestException as e:
            logging.error(f"Request failed: {e}")
            time.sleep(delay)
    logging.error("All retry attempts failed.")
    return None

@app.route('/', methods=['GET'])
def base():
    # Return a JSON response indicating the API is ready
    return jsonify({"message": "Your API is ready!"})

@app.route('/fetch_movie_data', methods=['GET'])
def fetch_movie_data():
    tmdb_id = request.args.get('tmdb_id')
    if not tmdb_id:
        return jsonify({"error": "tmdb_id parameter is missing"})

    tmdb_url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={TMDB_API_KEY}"
    tmdb_response = fetch_data_with_retry(tmdb_url, RETRY_ATTEMPTS, RETRY_DELAY)
    if not tmdb_response:
        return jsonify({"error": "Failed to fetch data from TMDB API"})

    try:
        tmdb_data = json.loads(tmdb_response)
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error: {e}")
        return jsonify({"error": "Failed to decode TMDB response"})

    if 'status_code' in tmdb_data:
        return jsonify({"error": "Invalid TMDB ID or API Key"})

    movie_title = tmdb_data.get('title')
    release_year = tmdb_data.get('release_date', '').split('-')[0]

    encoded_title = requests.utils.quote(movie_title)
    stream_url = f"https://9streams-consumet.vercel.app/movies/flixhq/{encoded_title}?page=1"
    stream_response = fetch_data_with_retry(stream_url, RETRY_ATTEMPTS, RETRY_DELAY)
    if not stream_response:
        return jsonify({"error": "Failed to fetch data from 9streams API"})

    try:
        stream_data = json.loads(stream_response)
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode error: {e}")
        return jsonify({"error": "Failed to decode 9streams response"})

    if 'results' not in stream_data:
        return jsonify({"error": "No results found from 9streams API"})

    correct_movie = next((result for result in stream_data['results'] 
                          if result['type'] == 'Movie' and result['title'] == movie_title 
                          and result['releaseDate'] == release_year), None)

    if correct_movie:
        movie_id = correct_movie['id']
        import re
        match = re.search(r'/watch-(.*?)-(\d+)$', movie_id)
        if match:
            episode_id = match.group(2)
        else:
            return jsonify({"error": "Failed to extract episodeId from movie ID"})

        watch_url = f"https://9streams-consumet.vercel.app/movies/flixhq/watch?episodeId={episode_id}&mediaId={movie_id}&server=upcloud"
        watch_response = fetch_data_with_retry(watch_url, RETRY_ATTEMPTS, RETRY_DELAY)
        if not watch_response:
            return jsonify({"error": "Failed to fetch data from the watch API"})

        info_url = f"https://9streams-consumet.vercel.app/movies/flixhq/info?id={movie_id}"
        info_response = fetch_data_with_retry(info_url, RETRY_ATTEMPTS, RETRY_DELAY)
        if not info_response:
            return jsonify({"error": "Failed to fetch data from the info API"})

        try:
            info_data = json.loads(info_response)
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode error: {e}")
            return jsonify({"error": "Failed to decode info API response"})

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

if __name__ == "__main__":
    app.run(debug=True)

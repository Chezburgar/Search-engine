import { fetchJSON } from '../lib/http.js';
import { lookupWeather } from '../../public/js/shared/weather.js';

export { parseWeatherQuery } from '../../public/js/shared/weather.js';

export const getWeather = (place) => lookupWeather(place, (url) => fetchJSON(url, { timeout: 4000 }));

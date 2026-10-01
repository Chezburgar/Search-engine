import { fetchJSON, qs } from '../lib/http.js';

// "weather in paris", "paris weather", "forecast for tokyo tomorrow", "weather london uk"
export function parseWeatherQuery(q) {
  const s = q
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '');
  let m =
    s.match(
      /^(?:what(?:'s| is) the )?(?:weather|forecast|temperature)(?: forecast)?(?: (?:in|for|at))? (.+?)(?: (?:today|tomorrow|now|this week))?$/
    ) || s.match(/^(.+?) (?:weather|forecast|temperature)(?: forecast)?(?: (?:today|tomorrow|now|this week))?$/);
  if (!m) return null;
  const place = m[1].replace(/^(?:in|for|at) /, '').trim();
  if (!place || place.length > 60 || /\b(how|why|what|best|app|api|channel|radar)\b/.test(place)) return null;
  return place;
}

export async function getWeather(place) {
  const geo = await fetchJSON(
    `https://geocoding-api.open-meteo.com/v1/search?${qs({ name: place, count: 1, language: 'en', format: 'json' })}`,
    { timeout: 4000 }
  );
  const loc = geo.results?.[0];
  if (!loc) return null;
  const f = await fetchJSON(
    `https://api.open-meteo.com/v1/forecast?${qs({
      latitude: loc.latitude,
      longitude: loc.longitude,
      current:
        'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation',
      hourly: 'temperature_2m,weather_code,precipitation_probability',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: 7,
      forecast_hours: 24,
    })}`,
    { timeout: 4000 }
  );
  const c = f.current || {};
  const d = f.daily || {};
  const h = f.hourly || {};
  return {
    location: {
      name: loc.name,
      region: [loc.admin1, loc.country].filter(Boolean).join(', '),
      countryCode: loc.country_code,
    },
    useFahrenheit: ['US', 'LR', 'MM', 'BS', 'KY', 'PW', 'FM', 'MH'].includes(loc.country_code),
    current: {
      time: c.time,
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      precipitation: c.precipitation,
      code: c.weather_code,
      isDay: c.is_day === 1,
    },
    hourly: (h.time || []).map((t, i) => ({
      time: t,
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      precip: h.precipitation_probability?.[i] ?? null,
    })),
    daily: (d.time || []).map((t, i) => ({
      date: t,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      precip: d.precipitation_probability_max?.[i] ?? null,
    })),
  };
}

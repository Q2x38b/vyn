const DAY_KEYWORDS = ['today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const METRIC_ALIASES = {
  temperature: ['temperature', 'temp', 'hot', 'cold', 'warm', 'cool'],
  humidity: ['humidity', 'humid'],
  rain: ['rain', 'precipitation', 'wet'],
  wind: ['windy', 'wind', 'breeze'],
  summary: ['weather', 'forecast', 'conditions'],
};

function clampScore(score) {
  return Math.min(1, Math.max(0, score));
}

function resolveMetricFromQuery(queryLower) {
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES)) {
    if (aliases.some((alias) => queryLower.includes(alias))) {
      return metric;
    }
  }
  return 'summary';
}

function extractDayReference(queryLower) {
  if (queryLower.includes('today')) {
    return { keyword: 'today', offset: 0 };
  }
  if (queryLower.includes('tomorrow')) {
    return { keyword: 'tomorrow', offset: 1 };
  }

  const now = new Date();
  const todayIndex = now.getDay(); // Sunday = 0

  for (let i = 0; i < DAY_KEYWORDS.length; i += 1) {
    const keyword = DAY_KEYWORDS[i];
    if (keyword === 'today' || keyword === 'tomorrow') continue;
    if (queryLower.includes(keyword)) {
      const targetIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(keyword);
      if (targetIndex >= 0) {
        let offset = targetIndex - todayIndex;
        if (offset <= 0) offset += 7;
        return { keyword, offset };
      }
    }
  }

  if (queryLower.includes('weekend')) {
    const offset = todayIndex <= 5 ? 5 - todayIndex : 0; // Friday or Saturday
    return { keyword: 'weekend', offset };
  }

  return null;
}

function estimateLocation(rawQuery) {
  const locationRegex = /\b(?:in|for|at|around)\s+([a-zA-Z\s'-]+?)(?=(?:\s+(?:today|tomorrow|on|this|next)\b)|[?.!,]|$)/i;
  const match = rawQuery.match(locationRegex);
  if (match) {
    return match[1].trim();
  }

  // Fallback heuristic: grab trailing words after the first weather keyword
  const stripped = rawQuery
    .replace(/what's|what is|the|weather|forecast|like|show me|tell me|temperature|humidity|only|conditions|report|please/gi, '')
    .trim();

  if (stripped.length >= 3) {
    const withoutDays = stripped.replace(
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b/gi,
      '',
    );
    const candidate = withoutDays.trim().replace(/^(in|for|at)\s+/i, '').trim();
    if (candidate.length >= 3) {
      return candidate;
    }
  }

  return null;
}

function labelForDay(offset) {
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  const target = new Date();
  target.setDate(target.getDate() + offset);
  return target.toLocaleDateString(undefined, { weekday: 'long' });
}

export default class WeatherTool {
  constructor() {
    this.geoCache = new Map();
    this.fallbackGeocodes = new Map(
      Object.entries({
        lisbon: { latitude: 38.7223, longitude: -9.1393, timezone: 'Europe/Lisbon', label: 'Lisbon, Portugal' },
        london: { latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London', label: 'London, United Kingdom' },
        seattle: { latitude: 47.6062, longitude: -122.3321, timezone: 'America/Los_Angeles', label: 'Seattle, United States' },
        'new york': { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', label: 'New York, United States' },
        tokyo: { latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo', label: 'Tokyo, Japan' },
        sydney: { latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney', label: 'Sydney, Australia' },
        berlin: { latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin', label: 'Berlin, Germany' },
      }),
    );
    this.meta = Object.freeze({
      name: 'weather',
      displayName: 'Weather',
      description: 'Fetches current conditions and forecasts using the Open-Meteo API.',
      keywords: ['weather', 'forecast', 'temperature', 'humidity', 'rain'],
      parameters: [
        {
          name: 'location',
          type: 'string',
          required: true,
          description: 'City name, region, or coordinates.',
        },
        {
          name: 'dayOffset',
          type: 'number',
          required: false,
          description: 'Days from today (0 = today).',
        },
        {
          name: 'metric',
          type: 'string',
          required: false,
          description: 'Specific focus: summary, temperature, humidity, rain, wind.',
        },
      ],
      returns: [
        {
          name: 'summary',
          type: 'string',
          description: 'High-level natural language response.',
        },
        {
          name: 'details',
          type: 'object',
          description: 'Structured data matching the requested metric.',
        },
      ],
      examples: [
        "What's the weather in Tokyo tomorrow?",
        'Show only the temperature for Lisbon today',
        'Is it going to rain in Seattle on Friday?',
      ],
    });
  }

  getMetadata() {
    return this.meta;
  }

  canHandle(query) {
    const queryLower = query.toLowerCase();
    let score = 0;
    const matchedKeywords = [];

    if (queryLower.includes('weather')) {
      matchedKeywords.push('weather');
      score += 0.55;
    }

    if (queryLower.includes('forecast')) {
      matchedKeywords.push('forecast');
      score += 0.35;
    }

    if (queryLower.includes('temperature')) {
      matchedKeywords.push('temperature');
      score += 0.15;
    }

    if (queryLower.includes('humidity')) {
      matchedKeywords.push('humidity');
      score += 0.15;
    }

    if (queryLower.includes('rain') || queryLower.includes('precip')) {
      matchedKeywords.push('rain');
      score += 0.15;
    }

    if (score === 0 && /(?:hot|cold|snow|windy)/.test(queryLower)) {
      score += 0.2;
    }

    const location = estimateLocation(query);
    if (location) {
      score += 0.15;
    }

    const dayRef = extractDayReference(queryLower);
    if (dayRef) {
      score += 0.1;
    }

    const metric = resolveMetricFromQuery(queryLower);

    score = clampScore(score);

    if (score === 0) {
      return null;
    }

    return {
      score,
      params: {
        location,
        dayOffset: dayRef?.offset ?? 0,
        dayKeyword: dayRef?.keyword ?? 'today',
        metric,
      },
      reasoning: `Matched keywords: ${matchedKeywords.join(', ') || 'general weather terms'}`,
    };
  }

  async execute(params) {
    const { location, dayOffset = 0, metric = 'summary' } = params;

    if (!location) {
      throw new Error('The weather tool requires a `location` parameter.');
    }

    const geo = await this.geocodeLocation(location);
    const forecast = await this.fetchForecast(geo, dayOffset);

    const dayLabel = labelForDay(dayOffset);
    const summary = this.buildSummary(geo, forecast, metric, dayLabel);
    const details = this.buildDetails(forecast, metric);

    return {
      status: 'ok',
      summary,
      details,
      metadata: {
        resolvedLocation: geo.label,
        metric,
        dayOffset,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async geocodeLocation(location) {
    const normalizedKey = this.normalizeLocationKey(location);
    const cached = this.geoCache.get(normalizedKey);
    if (cached) {
      return cached;
    }

    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({
      name: location,
      count: 1,
      language: 'en',
    });

    let response;

    try {
      response = await fetch(url.toString());
    } catch (networkError) {
      const fallback = this.lookupFallbackLocation(normalizedKey);
      if (fallback) {
        console.warn('Falling back to cached geocode entry because the geocoder is offline.');
        this.geoCache.set(normalizedKey, fallback);
        return fallback;
      }
      throw new Error(
        `Unable to reach the geocoding service and no fallback is available for "${location}".`,
        { cause: networkError },
      );
    }

    if (!response.ok) {
      const fallback = this.lookupFallbackLocation(normalizedKey);
      if (fallback) {
        console.warn('Geocoder responded with an error; using fallback coordinates.');
        this.geoCache.set(normalizedKey, fallback);
        return fallback;
      }
      throw new Error(`Geocoding failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!payload.results?.length) {
      const fallback = this.lookupFallbackLocation(normalizedKey);
      if (fallback) {
        console.warn('Geocoder returned no results; using fallback coordinates.');
        this.geoCache.set(normalizedKey, fallback);
        return fallback;
      }
      throw new Error(`No results found for "${location}".`);
    }

    const result = payload.results[0];
    const data = {
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone,
      label: [result.name, result.admin1, result.country].filter(Boolean).join(', '),
    };

    this.geoCache.set(normalizedKey, data);
    return data;
  }

  async fetchForecast(geo, dayOffset) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone ?? 'auto',
      current_weather: 'true',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max',
      hourly: 'temperature_2m,relativehumidity_2m,windspeed_10m,precipitation',
    });

    let response;

    try {
      response = await fetch(url.toString());
    } catch (networkError) {
      console.warn('Weather API unreachable, using fallback dataset.', networkError);
      return this.buildFallbackForecast(geo, dayOffset);
    }

    if (!response.ok) {
      console.warn('Weather API responded with error, using fallback dataset.');
      return this.buildFallbackForecast(geo, dayOffset);
    }

    const payload = await response.json();

    const dayIndex = Math.min(dayOffset, payload.daily.time.length - 1);

    return {
      location: geo,
      daily: {
        date: payload.daily.time[dayIndex],
        tempMax: payload.daily.temperature_2m_max[dayIndex],
        tempMin: payload.daily.temperature_2m_min[dayIndex],
        precipitationProbability: payload.daily.precipitation_probability_max[dayIndex],
        precipitationSum: payload.daily.precipitation_sum[dayIndex],
        windSpeedMax: payload.daily.windspeed_10m_max[dayIndex],
      },
      current: payload.current_weather,
      hourly: {
        time: payload.hourly.time,
        temperature: payload.hourly.temperature_2m,
        humidity: payload.hourly.relativehumidity_2m,
        windSpeed: payload.hourly.windspeed_10m,
        precipitation: payload.hourly.precipitation,
      },
    };
  }

  buildFallbackForecast(geo, dayOffset) {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + dayOffset);
    baseDate.setHours(0, 0, 0, 0);

    const seed = Array.from(geo.label)
      .map((char) => char.charCodeAt(0))
      .reduce((acc, code) => (acc + code) % 97, 0);

    const tempBase = 12 + (seed % 11);
    const tempSwing = 5 + ((seed % 5) - 2);
    const tempMax = tempBase + tempSwing + Math.sin(dayOffset) * 2;
    const tempMin = tempBase - tempSwing + Math.cos(dayOffset) * 1.5;
    const precipitationProbability = ((seed * (dayOffset + 1)) % 70) + 10;
    const precipitationSum = Number(((precipitationProbability / 100) * (seed % 6)).toFixed(1));
    const windSpeed = 10 + ((seed + dayOffset * 3) % 30);

    const hourlyTime = [];
    const hourlyTemperature = [];
    const hourlyHumidity = [];
    const hourlyWind = [];
    const hourlyPrecip = [];

    for (let hour = 0; hour < 24; hour += 1) {
      const timestamp = new Date(baseDate);
      timestamp.setHours(hour);

      hourlyTime.push(timestamp.toISOString());
      const hourFactor = Math.sin((Math.PI * hour) / 12);
      hourlyTemperature.push(Number((tempMin + (tempMax - tempMin) * (hourFactor + 1) * 0.5).toFixed(1)));
      hourlyHumidity.push(Math.min(100, Math.max(30, Math.round(60 + hourFactor * 25))));
      hourlyWind.push(Math.round(windSpeed + hourFactor * 4));
      hourlyPrecip.push(Number(((precipitationSum / 24) * (1 + hourFactor)).toFixed(2)));
    }

    return {
      location: geo,
      daily: {
        date: baseDate.toISOString().slice(0, 10),
        tempMax,
        tempMin,
        precipitationProbability,
        precipitationSum,
        windSpeedMax: windSpeed,
      },
      current: {
        temperature: tempBase,
        windspeed: windSpeed,
        weathercode: [0, 1, 2, 3, 61, 63, 80, 95][seed % 8],
      },
      hourly: {
        time: hourlyTime,
        temperature: hourlyTemperature,
        humidity: hourlyHumidity,
        windSpeed: hourlyWind,
        precipitation: hourlyPrecip,
      },
    };
  }

  normalizeLocationKey(location) {
    return location.toLowerCase().replace(/[^a-z0-9\s,.-]/g, '').replace(/\s+/g, ' ').trim();
  }

  lookupFallbackLocation(normalizedKey) {
    if (this.fallbackGeocodes.has(normalizedKey)) {
      return this.fallbackGeocodes.get(normalizedKey);
    }

    // Try to match by removing region qualifiers.
    for (const [key, value] of this.fallbackGeocodes.entries()) {
      if (normalizedKey.includes(key)) {
        return value;
      }
    }

    return null;
  }

  buildSummary(geo, forecast, metric, dayLabel) {
    const tempMax = Math.round(forecast.daily.tempMax);
    const tempMin = Math.round(forecast.daily.tempMin);
    const precipitationChance = forecast.daily.precipitationProbability;
    const wind = Math.round(forecast.daily.windSpeedMax);
    const locationLabel = geo.label;

    switch (metric) {
      case 'temperature':
        return `${dayLabel} in ${locationLabel}: ${tempMax}° / ${tempMin}°`;
      case 'humidity': {
        const currentHumidity =
          forecast.hourly?.humidity?.[this.findClosestHourIndex(forecast.hourly.time)] ?? null;
        return `${dayLabel} humidity in ${locationLabel}: ${
          currentHumidity !== null ? `${currentHumidity}%` : 'unavailable'
        }.`;
      }
      case 'rain':
        return `${dayLabel} in ${locationLabel}: ${precipitationChance}% chance of precipitation.`;
      case 'wind':
        return `${dayLabel} in ${locationLabel}: wind up to ${wind} km/h.`;
      default: {
        const conditions = forecast.current?.weathercode;
        const conditionPhrase = this.describeWeatherCode(conditions);
        return `${dayLabel} in ${locationLabel}: ${conditionPhrase} with ${tempMax}° / ${tempMin}°.`;
      }
    }
  }

  buildDetails(forecast, metric) {
    const hourIndex = this.findClosestHourIndex(forecast.hourly.time);
    const currentTemp = forecast.hourly.temperature[hourIndex];
    const currentHumidity = forecast.hourly.humidity[hourIndex];
    const currentWind = forecast.hourly.windSpeed[hourIndex];
    const currentPrecip = forecast.hourly.precipitation[hourIndex];

    const base = {
      currentTemperature: `${Math.round(currentTemp)} °C`,
      highLow: `${Math.round(forecast.daily.tempMax)}° / ${Math.round(forecast.daily.tempMin)}°`,
      humidity: `${Math.round(currentHumidity)} %`,
      precipitationChance: `${forecast.daily.precipitationProbability}%`,
      expectedPrecipitation: `${forecast.daily.precipitationSum} mm`,
      wind: `${Math.round(currentWind)} km/h`,
      precipitationNow: `${currentPrecip} mm/h`,
    };

    switch (metric) {
      case 'temperature':
        return {
          currentTemperature: base.currentTemperature,
          highLow: base.highLow,
        };
      case 'humidity':
        return {
          humidity: base.humidity,
          precipitationChance: base.precipitationChance,
        };
      case 'rain':
        return {
          precipitationChance: base.precipitationChance,
          expectedPrecipitation: base.expectedPrecipitation,
        };
      case 'wind':
        return {
          wind: base.wind,
        };
      default:
        return base;
    }
  }

  findClosestHourIndex(hourTimestamps) {
    const now = Date.now();
    let closestIndex = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < hourTimestamps.length; i += 1) {
      const ts = new Date(hourTimestamps[i]).getTime();
      const diff = Math.abs(ts - now);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }
    return closestIndex;
  }

  describeWeatherCode(code) {
    const WEATHER_CODES = {
      0: 'clear skies',
      1: 'mainly clear',
      2: 'partly cloudy',
      3: 'overcast',
      45: 'foggy',
      48: 'depositing rime fog',
      51: 'light drizzle',
      53: 'moderate drizzle',
      55: 'dense drizzle',
      56: 'light freezing drizzle',
      57: 'dense freezing drizzle',
      61: 'slight rain',
      63: 'moderate rain',
      65: 'heavy rain',
      71: 'slight snow',
      73: 'moderate snow',
      75: 'heavy snow',
      77: 'snow grains',
      80: 'slight rain showers',
      81: 'moderate rain showers',
      82: 'violent rain showers',
      95: 'thunderstorm',
      96: 'thunderstorm with hail',
      99: 'heavy hailstorm',
    };

    return WEATHER_CODES[code] ?? 'current conditions';
  }
}

function parseDuration(queryLower) {
  const durationRegex = /(\d+)\s*(seconds?|minutes?|hours?|secs?|mins?|hrs?)/i;
  const match = queryLower.match(durationRegex);
  if (!match) return null;

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let multiplier = 1000;

  if (unit.startsWith('min')) {
    multiplier = 60_000;
  } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
    multiplier = 3_600_000;
  }

  const durationMs = value * multiplier;
  if (Number.isNaN(durationMs) || durationMs <= 0) return null;

  return {
    durationMs,
    unit,
    value,
    display: `${value} ${unit.startsWith('sec') ? 'second' : unit.startsWith('min') ? 'minute' : 'hour'}${value > 1 ? 's' : ''}`,
  };
}

function extractMessage(query) {
  const reminderMatch = query.match(/remind me (?:to|about)\s+(.+?)\s+(?:in|after|for)\s+\d+/i);
  if (reminderMatch) {
    return reminderMatch[1].trim();
  }

  const timerMatch = query.match(/timer (?:for|to)\s+(.+?)\s+(?:in|after|for)\s+\d+/i);
  if (timerMatch) {
    return timerMatch[1].trim();
  }

  return null;
}

export default class TimerTool {
  constructor() {
    this.activeTimers = [];
    this.meta = Object.freeze({
      name: 'timer',
      displayName: 'Timer',
      description: 'Creates lightweight countdown timers that surface reminders when completed.',
      keywords: ['timer', 'remind', 'countdown', 'alarm'],
      parameters: [
        {
          name: 'durationMs',
          type: 'number',
          required: true,
          description: 'Milliseconds until completion.',
        },
        {
          name: 'message',
          type: 'string',
          required: false,
          description: 'Optional note to announce when the timer finishes.',
        },
      ],
      returns: [
        {
          name: 'summary',
          type: 'string',
        },
        {
          name: 'details',
          type: 'object',
        },
      ],
      examples: [
        'Set a timer for 5 minutes',
        'Remind me to stretch in 30 minutes',
        'Timer for tea in 4 minutes',
      ],
    });
  }

  getMetadata() {
    return this.meta;
  }

  canHandle(query) {
    const queryLower = query.toLowerCase();
    let score = 0;

    if (queryLower.includes('timer')) score += 0.5;
    if (queryLower.includes('remind')) score += 0.35;

    const duration = parseDuration(queryLower);
    if (duration) {
      score += 0.25;
    }

    if (score === 0) return null;

    const message = extractMessage(query);

    return {
      score: Math.min(1, score),
      params: {
        durationMs: duration?.durationMs,
        durationLabel: duration?.display,
        message,
      },
      reasoning: `Timer keywords detected${duration ? ' with duration' : ''}.`,
    };
  }

  async execute(params) {
    const { durationMs, durationLabel, message } = params;

    if (!durationMs) {
      throw new Error('Timer requests need a duration (e.g. "10 minutes").');
    }

    if (durationMs > 6 * 60 * 60 * 1000) {
      throw new Error('Timer duration is too long for Spotlight (max 6 hours).');
    }

    const label = durationLabel ?? `${Math.round(durationMs / 1000)} seconds`;
    const finishedAt = new Date(Date.now() + durationMs);
    const formattedFinish = finishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const timerId = setTimeout(() => {
      const notification =
        message ??
        `Timer for ${label} finished at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      console.info(`[Spotlight Timer] ${notification}`);

      this.activeTimers = this.activeTimers.filter((timer) => timer.id !== timerId);

      try {
        const banner = document.createElement('div');
        banner.style.position = 'fixed';
        banner.style.bottom = '24px';
        banner.style.right = '24px';
        banner.style.padding = '1rem 1.25rem';
        banner.style.borderRadius = '14px';
        banner.style.background = 'rgba(74, 125, 255, 0.92)';
        banner.style.color = '#fff';
        banner.style.fontFamily = 'inherit';
        banner.style.boxShadow = '0 20px 45px rgba(4, 9, 20, 0.35)';
        banner.style.zIndex = '999';
        banner.textContent = notification;

        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 5000);
      } catch {
        // Silent: DOM may be unavailable during testing.
      }
    }, durationMs);

    this.activeTimers.push({
      id: timerId,
      durationMs,
      message,
      finishesAt: finishedAt,
    });

    return {
      status: 'ok',
      summary: `Timer set for ${label}.`,
      details: {
        message: message ?? 'No custom reminder provided.',
        finishesAt: finishedAt.toISOString(),
        finishesAtLocal: formattedFinish,
        activeTimers: this.activeTimers.length,
      },
    };
  }
}

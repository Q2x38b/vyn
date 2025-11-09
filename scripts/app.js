import ToolRegistry from './toolRegistry.js';
import NLPInterpreter from './nlpInterpreter.js';
import WeatherTool from './tools/WeatherTool.js';
import TimerTool from './tools/TimerTool.js';

const registry = new ToolRegistry();
registry.register(new WeatherTool());
registry.register(new TimerTool());

const nlp = new NLPInterpreter(registry);

const inputEl = document.getElementById('spotlight-input');
const submitEl = document.getElementById('spotlight-submit');
const resultPanelEl = document.getElementById('result-panel');
const contextContainerEl = document.getElementById('tools-context');

const summaryEl = document.createElement('div');
summaryEl.className = 'result-panel__summary';

const statusEl = document.createElement('div');
statusEl.className = 'result-panel__status';

const detailsEl = document.createElement('div');
detailsEl.className = 'result-panel__details';

resultPanelEl.append(summaryEl, statusEl, detailsEl);

function renderContext() {
  const tools = registry.listTools();
  contextContainerEl.innerHTML = '';

  tools.forEach((tool) => {
    const card = document.createElement('article');
    card.className = 'tool-card';

    const keywordBadges = (tool.keywords ?? []).slice(0, 6);

    card.innerHTML = `
      <div class="tool-card__name">
        <span>${tool.displayName ?? tool.name}</span>
        <span class="tool-card__badge">${tool.name}</span>
      </div>
      <p class="tool-card__description">${tool.description}</p>
      <div class="tool-card__meta">
        ${tool.parameters
          .map(
            (param) =>
              `<span>${param.required ? '• ' : ''}${param.name}: ${param.type}${
                param.required ? '' : ' (optional)'
              }</span>`,
          )
          .join('')}
      </div>
      ${
        keywordBadges.length
          ? `<div class="tool-card__meta">${keywordBadges
              .map((kw) => `<span>#${kw}</span>`)
              .join('')}</div>`
          : ''
      }
      ${
        tool.examples?.length
          ? `<p class="tool-card__examples">e.g. ${tool.examples
              .map((ex) => `<code>${ex}</code>`)
              .join(' ')}</p>`
          : ''
      }
    `;

    contextContainerEl.appendChild(card);
  });
}

function setResultPanelVisible(visible) {
  resultPanelEl.classList.toggle('hidden', !visible);
}

function setStatusLabel(status, toolName) {
  const base = `Tool: ${toolName}`;
  if (status === 'ok') {
    statusEl.className = 'result-panel__status result-panel__status--ok';
    statusEl.textContent = `${base} • success`;
  } else if (status === 'error') {
    statusEl.className = 'result-panel__status result-panel__status--error';
    statusEl.textContent = `${base} • error`;
  } else if (status === 'pending') {
    statusEl.className = 'result-panel__status';
    statusEl.textContent = `${base} • working...`;
  } else {
    statusEl.className = 'result-panel__status';
    statusEl.textContent = base;
  }
}

function stringifyDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  if (Array.isArray(details)) return details.join('\n');
  if (typeof details === 'object') return JSON.stringify(details, null, 2);
  return String(details);
}

async function handleSubmit() {
  const query = inputEl.value.trim();
  if (!query) {
    setResultPanelVisible(true);
    summaryEl.textContent = 'Waiting for a request...';
    statusEl.className = 'result-panel__status';
    statusEl.textContent = '';
    detailsEl.textContent = '';
    return;
  }

  setResultPanelVisible(true);
  summaryEl.textContent = 'Interpreting query...';
  statusEl.className = 'result-panel__status';
  statusEl.textContent = '';
  detailsEl.textContent = '';

  const interpretation = nlp.interpret(query);

  if (!interpretation.success) {
    summaryEl.textContent = interpretation.message ?? 'Unable to interpret the request.';
    setStatusLabel('error', 'NLP');

    if (interpretation.candidates?.length) {
      const hints = interpretation.candidates
        .slice(0, 3)
        .map((candidate) => `${candidate.toolName} (${Math.round(candidate.score * 100)}%)`)
        .join('\n');
      detailsEl.textContent = `Closest matches:\n${hints}`;
    } else {
      detailsEl.textContent = '';
    }

    return;
  }

  const { toolName, params } = interpretation;
  summaryEl.textContent = `Executing ${toolName}...`;
  setStatusLabel('pending', toolName);
  detailsEl.textContent = JSON.stringify(params, null, 2);

  try {
    const result = await registry.execute(toolName, params, {
      rawQuery: query,
      interpretation,
      context: nlp.getContextPayload(),
    });

    summaryEl.textContent = result.summary ?? 'Execution complete.';
    setStatusLabel(result.status ?? 'ok', toolName);
    detailsEl.textContent = stringifyDetails(result.details);
  } catch (error) {
    console.error(error);
    summaryEl.textContent = error.message ?? 'Tool execution failed.';
    setStatusLabel('error', toolName);
    detailsEl.textContent = stringifyDetails(error.stack ?? '');
  }
}

submitEl.addEventListener('click', handleSubmit);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleSubmit();
  }
});

renderContext();
window.spotlightContext = nlp.getContextPayload();

class SentimentGauge extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._data = {
      thumbsup: 0, heart: 0, fire: 0, pray: 0, ok: 0, funny: 0,
      neutral: 0,
      thumbsdown: 0, frown: 0, rage: 0
    };

    // Emojis mapping for tooltip display
    this.emojiMap = {
      thumbsup: '👍', heart: '❤️', fire: '🔥', pray: '🙏', ok: '👌', funny: '😄',
      neutral: '😐',
      thumbsdown: '👎', frown: '☹️', rage: '😡'
    };

    // Categories
    this.categories = {
      positive: ['thumbsup', 'heart', 'fire', 'pray', 'ok', 'funny'],
      neutral: ['neutral'],
      negative: ['thumbsdown', 'frown', 'rage']
    };

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          width: 300px;
          margin: 0 auto;
        }

        .gauge-container {
          position: relative;
          width: 100%;
          padding-top: 50%; /* 2:1 aspect ratio for semi-circle */
          overflow: hidden;
          margin-bottom: 20px;
        }

        .gauge-svg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        .needle {
          transform-origin: 100px 100px; /* Rotate around the bottom center of viewBox */
          transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .needle-path {
          fill: var(--body-text);
        }

        .needle-pivot {
          fill: var(--body-text);
        }

        .stats {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 14px;
          color: var(--body-text);
        }

        .stat-line {
          position: relative;
          cursor: pointer;
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          transition: background-color 0.2s;
        }

        .stat-line:hover {
          background-color: #f5f5f5;
        }

        .total {
          margin-top: 12px;
          font-weight: 500;
          color: #444;
          padding: 4px 8px;
        }

        /* Tooltip */
        .tooltip {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(10px) scale(0.95);
          background: white;
          border: 1px solid #eee;
          padding: 12px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease-out;
          z-index: 10;
          min-width: 120px;
          pointer-events: none;
        }

        .stat-line:hover .tooltip,
        .stat-line:focus .tooltip {
          opacity: 1;
          visibility: visible;
          transform: translateX(-50%) translateY(-8px) scale(1);
        }

        .tooltip-title {
          font-weight: 600;
          margin-bottom: 8px;
          color: #333;
          border-bottom: 1px solid #eee;
          padding-bottom: 4px;
          text-align: center;
        }

        .tooltip-item {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
          color: #555;
        }

        .tooltip-emoji {
          margin-right: 12px;
        }
      </style>

      <div class="gauge-wrapper" role="region" aria-label="Audience Reaction Gauge">
        <div class="gauge-container">
          <svg class="gauge-svg" viewBox="0 0 200 110" preserveAspectRatio="xMidYMax meet">
            <!-- Arcs -->
            <!-- Negative Segment (0-33%) -->
            <path d="M 20 100 A 80 80 0 0 1 60 30.71" fill="none" stroke="#FF8A80" stroke-width="40" />
            <!-- Neutral Segment (33-66%) -->
            <path d="M 60 30.71 A 80 80 0 0 1 140 30.71" fill="none" stroke="#BDBDBD" stroke-width="40" />
            <!-- Positive Segment (66-100%) -->
            <path d="M 140 30.71 A 80 80 0 0 1 180 100" fill="none" stroke="#69F0AE" stroke-width="40" />

            <!-- Needle -->
            <g class="needle" id="gauge-needle" transform="rotate(-90 100 100)">
              <path class="needle-path" d="M 97 100 L 100 20 L 103 100 Z" />
              <circle class="needle-pivot" cx="100" cy="100" r="5" />
            </g>
          </svg>
        </div>

        <div class="stats" id="stats-container">
          <div class="stat-line" id="stat-negative" tabindex="0">
            <span id="text-negative">0.0% Negative</span>
            <div class="tooltip" id="tooltip-negative"></div>
          </div>
          <div class="stat-line" id="stat-neutral" tabindex="0">
            <span id="text-neutral">0.0% Neutral</span>
            <div class="tooltip" id="tooltip-neutral"></div>
          </div>
          <div class="stat-line" id="stat-positive" tabindex="0">
            <span id="text-positive">0.0% Positive</span>
            <div class="tooltip" id="tooltip-positive"></div>
          </div>
          <div class="total" id="text-total">Total reactions: 0</div>
        </div>
      </div>
    `;
  }

  set data(newData) {
    this._data = { ...this._data, ...newData };
    this.render();
  }

  get data() {
    return this._data;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;

    // Calculate category counts
    this.categories.positive.forEach(key => positiveCount += (this._data[key] || 0));
    this.categories.neutral.forEach(key => neutralCount += (this._data[key] || 0));
    this.categories.negative.forEach(key => negativeCount += (this._data[key] || 0));

    const total = positiveCount + neutralCount + negativeCount;

    let score = 50; // Default center
    if (total > 0) {
      score = ((positiveCount * 100) + (neutralCount * 50) + (negativeCount * 0)) / total;
    }

    // Clamp between 0 and 100
    score = Math.max(0, Math.min(100, score));

    let positivePercent = 0;
    let neutralPercent = 0;
    let negativePercent = 0;

    if (total > 0) {
      positivePercent = (positiveCount / total) * 100;
      neutralPercent = (neutralCount / total) * 100;
      negativePercent = (negativeCount / total) * 100;
    }

    // Format to 1 decimal place
    positivePercent = positivePercent.toFixed(1);
    neutralPercent = neutralPercent.toFixed(1);
    negativePercent = negativePercent.toFixed(1);

    // Update Needle
    const needle = this.shadowRoot.getElementById('gauge-needle');
    // Map score (0 to 100) to degrees (-90 to 90). The original SVG path is at -90, so we just rotate by the mapped amount
    // score 0 -> rotation -90
    // score 50 -> rotation 0
    // score 100 -> rotation 90
    // formula: (score / 100) * 180 - 90
    const degrees = (score / 100) * 180 - 90;
    needle.style.transform = `rotate(${degrees}deg)`;

    // Update Text
    this.shadowRoot.getElementById('text-negative').textContent = `${negativePercent}% Negative`;
    this.shadowRoot.getElementById('text-neutral').textContent = `${neutralPercent}% Neutral`;
    this.shadowRoot.getElementById('text-positive').textContent = `${positivePercent}% Positive`;
    this.shadowRoot.getElementById('text-total').textContent = `Total reactions: ${total}`;

    // Update Tooltips
    this.updateTooltip('negative', 'Negative', negativeCount);
    this.updateTooltip('neutral', 'Neutral', neutralCount);
    this.updateTooltip('positive', 'Positive', positiveCount);
  }

  updateTooltip(category, label, count) {
    const tooltip = this.shadowRoot.getElementById(`tooltip-${category}`);

    let html = `<div class="tooltip-title">${label}: ${count}</div>`;

    let hasEmojis = false;
    this.categories[category].forEach(key => {
      const emojiCount = this._data[key] || 0;
      if (emojiCount > 0) {
        hasEmojis = true;
        html += `
          <div class="tooltip-item">
            <span class="tooltip-emoji">${this.emojiMap[key]}</span>
            <span>${emojiCount}</span>
          </div>
        `;
      }
    });

    if (!hasEmojis) {
      html += `<div class="tooltip-item">No reactions</div>`;
    }

    tooltip.innerHTML = html;
  }
}

customElements.define('sentiment-gauge', SentimentGauge);

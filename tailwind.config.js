/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        hex: {
          bg: '#0a0a0f',
          surface: '#0f0f1a',
          border: '#1a1a2e',
          accent: '#e63946',
          'accent-dim': '#c1121f',
          muted: '#6b7280',
          text: '#e2e8f0',
          'text-dim': '#94a3b8',
          green: '#00ff41',
          cyan: '#00d4ff',
          purple: '#8b5cf6',
          orange: '#f97316',
          yellow: '#fbbf24',
        },
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      spacing: {
        '72': '18rem',
        '84': '21rem',
        '96': '24rem',
      },
      animation: {
        'blink': 'blink 1s step-end infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'slide-in': 'slide-in 0.3s ease-out forwards',
        'slide-in-bottom': 'slide-in-bottom 0.3s ease-out forwards',
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        glow: {
          from: { boxShadow: '0 0 5px #e63946, 0 0 10px #e63946' },
          to: { boxShadow: '0 0 10px #e63946, 0 0 20px #e63946, 0 0 40px #e63946' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-bottom': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
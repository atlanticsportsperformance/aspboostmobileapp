/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Match web app's custom radius values
      borderRadius: {
        'sm': '2px',
        DEFAULT: '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '10px',
        '2xl': '12px',
        '3xl': '16px',
      },
      // Custom colors to match web app design system
      colors: {
        // ASP Brand Colors
        'asp-dark': '#0A0A0A',
        'asp-blue': {
          light: '#9BDDFF',
          DEFAULT: '#7BC5F0',
        },
        // Glass effect overlays
        glass: {
          DEFAULT: 'rgba(255, 255, 255, 0.02)',
          hover: 'rgba(255, 255, 255, 0.04)',
          border: 'rgba(255, 255, 255, 0.05)',
          'border-hover': 'rgba(255, 255, 255, 0.08)',
        },
        // Text colors
        text: {
          primary: '#FFFFFF',
          secondary: 'rgba(255, 255, 255, 0.6)',
          tertiary: 'rgba(255, 255, 255, 0.4)',
        },
        // Input colors
        input: {
          bg: 'rgba(255, 255, 255, 0.03)',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-hover': 'rgba(255, 255, 255, 0.12)',
          'border-focus': 'rgba(255, 255, 255, 0.2)',
        },
      },
      // Custom shadows (converted to React Native compatible format)
      boxShadow: {
        'premium': '0 0 0 1px rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 8px rgba(0, 0, 0, 0.3)',
        'premium-lg': '0 0 0 1px rgba(255, 255, 255, 0.05), 0 4px 6px rgba(0, 0, 0, 0.4), 0 8px 16px rgba(0, 0, 0, 0.3), 0 16px 32px rgba(0, 0, 0, 0.2)',
      },
    },
  },
  plugins: [],
}

# Fetch Portfolio Website

A modern, minimalistic portfolio website for Fetch - a company specializing in vending machine setup and management.

## Features

- 🎨 Modern, minimalistic design with custom accent color (#92ddfa)
- ⚡ Built with React and Vite for fast development
- 📱 Fully responsive design
- ✨ Smooth animations and transitions
- 🎯 SEO-friendly structure
- 🚀 Optimized performance

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser and navigate to `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
portfolio-fetch/
├── src/
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── Hero.jsx
│   │   ├── About.jsx
│   │   ├── Services.jsx
│   │   ├── Portfolio.jsx
│   │   ├── Contact.jsx
│   │   └── Footer.jsx
│   ├── App.jsx
│   ├── App.css
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
└── vite.config.js
```

## Customization

### Colors

The accent color (#92ddfa) is defined in `src/index.css` as a CSS variable:
```css
:root {
  --accent-color: #92ddfa;
}
```

You can easily change this and other colors by modifying the CSS variables.

### Content

Edit the component files in `src/components/` to update:
- Company information
- Services offered
- Portfolio projects
- Contact details

## Technologies Used

- React 18
- Vite
- CSS3 (Custom Properties, Flexbox, Grid)
- Intersection Observer API (for scroll animations)

## License

This project is private and proprietary.


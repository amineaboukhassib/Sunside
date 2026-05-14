# Sunside ☀️

**Sunside** is a live, interactive web application that helps you find sunny cafes in the Cihangir neighborhood of Istanbul. By combining live weather data, solar positioning, and Google Maps, Sunside calculates which cafes currently have outdoor seating exposed to the sun and lets you preview sun paths throughout the day.

## Features

- **Live Sun Map:** View real-time sun exposure for over 20 cafes in Cihangir.
- **Time Preview:** Use the interactive slider to see how the sun will hit cafes at different times of the day (from 06:00 to 20:00).
- **Cafe Details:** Click on any cafe to see its current "Sun Score", outdoor seating availability, estimated walking distance, and annual sunshine metrics.
- **Live Weather Integration:** Real-time updates on local temperature and wind conditions.
- **AI Assistant:** A built-in chat feature that knows all the cafes, their current sun positions, and the live weather—just ask!

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, and CSS
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Dependencies:** 
  - [SunCalc](https://github.com/mourner/suncalc) (for calculating sun position and phases)
- **Data Sources:** 
  - Weather: Open-Meteo
  - Places/Map: Google Maps API

## Getting Started

### Prerequisites
Make sure you have Node.js and npm installed on your machine.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/amineaboukhassib/Sunside.git
   ```
2. Navigate to the project directory:
   ```bash
   cd Sunside
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

### Running Locally

To start the development server:
```bash
npm run dev
```
Then, open your browser and go to `http://localhost:5173` (or the port specified by Vite in your terminal).

### Building for Production

To build the app for production:
```bash
npm run build
```
The optimized files will be generated in the `dist` directory. You can preview the production build using:
```bash
npm run preview
```

## Data Attribution
- Sun Data: [SunCalc](https://github.com/mourner/suncalc)
- Weather Data: [Open-Meteo](https://open-meteo.com/)
- Locations: Google Places API

## License
[MIT License](LICENSE) (or specify your license here)

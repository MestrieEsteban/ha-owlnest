# Contributing to Owlnest 3D Floorplan

Thank you for your interest in contributing! Here's how to get started.

## Development setup

```bash
git clone https://github.com/esteban-dev/HA.git
cd HA
npm install
npm run build
```

Copy `dist/ha-3d-floorplan.js` to your Home Assistant `config/www/` folder and register it as a resource.

## Making changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes in `src/`
4. Build: `npm run build`
5. Test in Home Assistant
6. Open a Pull Request

## Code style

- TypeScript strict mode
- Keep `src/types.ts` updated for new config options
- Comment complex Three.js / WebGL logic
- Prefer small, focused commits

## Reporting bugs

Open an issue with:
- Your YAML configuration (remove private entity names if needed)
- Browser + OS
- Home Assistant version
- Browser console errors (F12 → Console)

# WAISL FinSight — frontend

React 19 single-page app (Create React App via CRACO, Tailwind, React Router 7, recharts, Phosphor icons).
See the [root README](../README.md) for the architecture and full setup.

```bash
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8001" > .env
yarn start            # dev server on http://localhost:3000
CI=true yarn build    # production build (lint warnings fail it, as on CI)
```

- `@` is an alias for `src/` (see `craco.config.js`).
- Workspace sections — sidebar, routes, landing order, the roles editor — come from `src/config/sections.js`;
  keep it in step with `backend/sections.py` (a backend test checks this).
- Shared building blocks live in `src/components/common/` (Modal, Popover, BulkUploadModal, StatTile, …).
- Browser storage keys are prefixed `fs_`; `src/lib/storageKeys.js` migrates the old `cp_` keys once.
- Deployed on Vercel with `yarn install --frozen-lockfile`: always commit `yarn.lock` changes made with Yarn 1.

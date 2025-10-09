# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Tenant Dashboard application with a full-stack architecture:
- **Backend**: Node.js/Express server (`tenant-dashboard/`) with MongoDB, Puppeteer for web scraping
- **Frontend**: Vue 3/Vite application (`tenant-frontend/`) with Tailwind CSS
- **Database**: MongoDB with Mongoose ODM

## Development Commands

### Local Development
- **Start both services**: `./start.sh` (backend on port 5001, frontend on port 5173)
- **Stop services**: `./start.sh stop`
- **Backend only**: `cd tenant-dashboard && npm start`
- **Frontend only**: `cd tenant-frontend && pnpm run dev`
- **Frontend build**: `cd tenant-frontend && pnpm run build`

### Database
- **Start MongoDB**: `bash scripts/mongo-up.sh` (uses local-mongo/data directory)
- **Stop MongoDB**: `bash scripts/mongo-down.sh`

### Backend Setup
- Copy `tenant-dashboard/.env.example` to `tenant-dashboard/.env`
- Required environment variables:
  - `MONGO_URI=mongodb://127.0.0.1:27017/tenantDB`
  - `PLATFORM_USERNAME` and `PLATFORM_PASSWORD` (for web scraping)
  - `PLATFORM_CONTRACT_ID` (e.g., 1489)

## Architecture

### Backend Structure (`tenant-dashboard/`)
- **Entry point**: `index.js` - Express server with sync status management
- **Models**: `models/` - Mongoose schemas (Student, Tenant, RoomFlag)
- **Routes**: `routes/` - API endpoints (tenant.routes.js, student.routes.js, room.routes.js)
- **Services**: `services/` - Core business logic (syncService.js for web scraping)
- **Configuration**: `config/db.js` - MongoDB connection

### Frontend Structure (`tenant-frontend/`)
- **Entry point**: `src/main.js` - Vue 3 app initialization
- **Components**: `src/components/` - BuildingGrid.vue, StudentsTable.vue
- **Assets**: `src/assets/` - CSS and icons
- **Build tool**: Vite with proxy to backend (`/api` → `localhost:5001`)

### Key Features
- **Data Sync**: Web scraping via Puppeteer to external platform
- **Building Grid**: Visual room occupancy display with room flags
- **Student Management**: CRUD operations for student records
- **Room Flags**: Mark rooms as unavailable (type 'vip')

## API Endpoints

### Sync & Status
- `GET /api/sync/status` - Check sync status and cooldown
- `POST /api/sync` - Trigger manual data sync (5-minute cooldown)
- `POST /api/sync/reconcile` - Reconcile student and tenant data

### Data Access
- `GET /api/tenants` - Building grid data
- `GET /api/students` - Student list with filtering
- `GET /api/stats` - Summary statistics
- `GET /api/rooms/flags` - Room flag list
- `PUT /api/rooms/flags/:roomNumber` - Set room flag
- `DELETE /api/rooms/flags/:roomNumber` - Clear room flag

## Production Deployment

### Server Setup
- **Target directory**: `/opt/tenant-app`
- **Backend**: PM2 process on port 5001
- **Frontend**: Built static assets served by backend
- **Environment**: Use `.env.production` in `tenant-dashboard/`

### Deployment Commands
- **Full deployment**: `./deploy-to-server.sh` or `./deploy.sh`
- **Server-side setup**: See `scripts/deploy-xiebin.sh`
- **PM2 configuration**: `ecosystem.config.js`

### Key Production Notes
- Use `PUPPETEER_SKIP_DOWNLOAD=1` to use system Chrome instead of downloading Chromium
- Backend serves frontend from `tenant-frontend/dist` if present
- Sync cooldown: 5 minutes between sync operations
- Room flags use single 'vip' type for unavailable rooms

## Development Notes

- Frontend proxies API calls to backend during development
- Backend includes fallback sync status from database if memory state is lost
- Room flags affect UI display: flagged rooms hide occupant names
- Student data includes check-in status and tags for categorization
- Web scraping service handles authentication and data extraction from external platform
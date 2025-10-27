# Databricks Agent Chat Application

> **Architecture:** Express + React SPA with TypeScript

A production-ready chat application for interacting with Databricks Agent Serving endpoints and Agent Bricks. Built with Express.js backend, React SPA frontend, and full Databricks integration.

## 📁 Project Structure

```
├── client/                 # React SPA (Vite + React Router)
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── pages/         # Route components
│   │   ├── layouts/       # Layout components
│   │   ├── contexts/      # React contexts
│   │   ├── hooks/         # Custom hooks
│   │   ├── lib/           # Client utilities
│   │   ├── App.tsx        # Root component
│   │   └── main.tsx       # Entry point
│   ├── public/            # Static assets
│   ├── index.html         # HTML template
│   ├── vite.config.ts     # Vite configuration
│   ├── package.json
│   └── tsconfig.json
│
├── server/                # Express API
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── middleware/   # Express middleware
│   │   └── index.ts      # Express app entry
│   ├── package.json
│   └── tsconfig.json
│
├── shared/               # Shared code
│   ├── databricks/      # Databricks integration
│   │   ├── auth/        # Authentication
│   │   ├── db/          # Database & ORM
│   │   ├── providers/   # AI providers
│   │   └── utils/       # Utilities
│   └── lib/             # Shared utilities & types
│
├── tests/               # E2E tests (Playwright)
├── scripts/             # Utility scripts
├── package.json         # Root workspace config
└── tsconfig.json        # Root TS config
```

## ✨ Features

- **Databricks Agent Integration** - Direct connection to Agent Serving endpoints and Agent Bricks
- **Real-time Streaming** - AI responses stream in real-time via Server-Sent Events
- **Persistent Chat History** - Databricks Lakebase (PostgreSQL) for conversation storage
- **Authentication** - Databricks OAuth, CLI auth, or headers-based auth
- **Multi-Model Support** - Switch between different AI models
- **Rich Content** - Markdown, syntax highlighting, math (KaTeX), Mermaid diagrams
- **Tool Calling** - Support for function execution and tool use
- **Image Attachments** - Upload and include images in conversations
- **Dark/Light Theme** - System-aware theme switching
- **Responsive Design** - Mobile-friendly interface
- **Chat Sharing** - Public/private conversation visibility
- **Rate Limiting** - User-based message rate limits
- **Stream Resumption** - Automatic reconnection on network issues

## 🚀 Quick Start

### Prerequisites

1. **Node.js 18+**
2. **PostgreSQL** database (or Databricks Lakebase)
3. **Databricks workspace** with Agent Serving endpoint
4. **Databricks CLI** (for local development)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd e2e-chatbot-app-next

# Install dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Install server dependencies
cd server && npm install && cd ..
```

### Configuration

1. **Create `.env.local` file:**

   ```bash
   cp .env.example .env.local
   ```

2. **Configure environment variables:**

   ```env
   # Database
   PGHOST=your-postgres-host
   PGUSER=your-postgres-user
   PGDATABASE=your-database-name
   PGPORT=5432

   # Databricks
   DATABRICKS_HOST=your-workspace-url
   DATABRICKS_SERVING_ENDPOINT=your-agent-endpoint

   # Authentication (choose one)
   # Option 1: OAuth (production)
   DATABRICKS_CLIENT_ID=your-client-id
   DATABRICKS_CLIENT_SECRET=your-client-secret

   # Option 2: CLI (development)
   DATABRICKS_CONFIG_PROFILE=your-profile-name
   ```

3. **Set up Databricks authentication:**
   ```bash
   databricks auth login --profile your-profile-name
   ```

### Run Migrations

```bash
npm run db:migrate
```

### Start Development Servers

```bash
# Start both client and server
npm run dev

# Or start individually:
npm run dev:server  # Express API on :3001
npm run dev:client  # Vite dev server on :3000
```

Open http://localhost:3000 in your browser.

## 🏗️ Architecture

### Request Flow

```
Browser (localhost:3000)
    ↓
Vite Dev Server (dev) / Static Files (prod)
    ↓ [proxy /api/*]
Express API Server (localhost:3001)
    ↓
┌─────────────┬──────────────────┐
│             │                  │
Databricks    PostgreSQL      Session
Agents        Database        Management
```

### Authentication Flow

1. Client loads and fetches session from `/api/session`
2. Express middleware validates auth (OAuth/CLI/headers)
3. Session stored in React context
4. All API calls include credentials
5. Express validates session for each request

### Streaming Flow

1. Client sends message to `POST /api/chat`
2. Express streams response via Server-Sent Events (SSE)
3. Client receives chunks via Vercel AI SDK `useChat` hook
4. UI updates in real-time
5. Complete message saved to database

## 📡 API Endpoints

All endpoints require authentication except `/ping`.

| Method | Endpoint                     | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/ping`                      | Health check                         |
| GET    | `/api/session`               | Get current user session             |
| GET    | `/api/history`               | Get chat history (paginated)         |
| POST   | `/api/chat`                  | Send message, get streaming response |
| DELETE | `/api/chat?id=:id`           | Delete a chat                        |
| GET    | `/api/chat/:id/stream`       | Resume a stream                      |
| GET    | `/api/chat/:id/messages`     | Get messages for a chat              |
| POST   | `/api/chat/title`            | Generate chat title                  |
| PATCH  | `/api/chat/:id/visibility`   | Update chat visibility               |
| DELETE | `/api/messages/:id/trailing` | Delete trailing messages             |

## 🔧 Development

### Available Scripts

```bash
# Development
npm run dev              # Start both servers
npm run dev:server       # Start Express only
npm run dev:client       # Start Vite only

# Building
npm run build            # Build both client and server
npm run build:client     # Build client only
npm run build:server     # Build server only

# Production
npm start                # Start production server

# Database
npm run db:migrate       # Run migrations
npm run db:generate      # Generate new migration
npm run db:studio        # Open Drizzle Studio
npm run db:reset         # Reset database (dev only!)

# Code Quality
npm run lint             # Run linter
npm run format           # Format code

# Testing
npm test                 # Run E2E tests
```

### Project Configuration

#### Client (`client/vite.config.ts`)

- Vite with React plugin
- API proxy to Express server
- Path aliases: `@/` → `src/`, `@shared/` → `../shared/`
- Tailwind CSS v4

#### Server (`server/tsconfig.json`)

- TypeScript ES2022
- Path alias: `@shared/` → `../shared/`
- Output to `dist/`

#### Shared (`tsconfig.json`)

- Root config for shared code
- Path alias: `@shared/` → `./shared/`

## 🌐 Deployment

### Databricks Apps

```bash
# Deploy using Asset Bundles
databricks bundle deploy
```

The app will be deployed with:

- Express server serving both API and static files
- Database connection to Lakebase
- Authentication via Databricks platform

### Docker

```bash
# Build
docker build -t chatbot-app .

# Run
docker run -p 3001:3001 --env-file .env chatbot-app
```

### Other Platforms

Deploy as a standard Node.js app to:

- AWS (EC2, ECS, Lambda)
- Google Cloud (Cloud Run, App Engine)
- Azure (App Service, Container Apps)
- Heroku, Railway, Render, etc.

**Requirements:**

- Node.js 18+ runtime
- PostgreSQL database
- Environment variables configured

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in UI mode
npx playwright test --ui

# Run specific test file
npx playwright test tests/e2e/chat.test.ts
```

Tests use:

- **Playwright** for E2E testing
- **MSW** (Mock Service Worker) for API mocking
- Page object model pattern

## 🛠️ Tech Stack

### Frontend

- **React 18** - UI library
- **React Router 6** - Client-side routing
- **Vite 5** - Build tool and dev server
- **Tailwind CSS 4** - Styling
- **Radix UI** - Accessible components
- **Framer Motion** - Animations
- **Vercel AI SDK** - AI/chat streaming
- **SWR** - Data fetching/caching

### Backend

- **Express 4** - Web server
- **TypeScript 5** - Type safety
- **Drizzle ORM** - Database ORM
- **Zod** - Schema validation

### Shared

- **Databricks SDK** - Agent integration
- **PostgreSQL** - Database
- **Server-Sent Events** - Real-time streaming

### Development

- **Biome** - Linting and formatting
- **Playwright** - E2E testing
- **MSW** - API mocking
- **Concurrently** - Run multiple processes

## 📚 Documentation

- [Refactoring Guide](./REFACTORING_GUIDE.md) - Migration from Next.js
- [Refactoring Summary](./REFACTORING_SUMMARY.md) - Overview of changes
- [Cleanup Plan](./CLEANUP_PLAN.md) - Architecture reorganization
- [Databricks Docs](https://docs.databricks.com) - Databricks documentation

## 🐛 Troubleshooting

### Port Already in Use

```bash
lsof -ti:3001 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Database Connection Error

- Check PostgreSQL is running
- Verify environment variables
- Run migrations: `npm run db:migrate`

### Authentication Fails

- Verify Databricks credentials
- Check `DATABRICKS_HOST` URL format
- For CLI: Run `databricks auth login`

### Components Not Loading

- Clear `node_modules` and reinstall
- Check TypeScript errors: `tsc --noEmit`
- Verify all imports use correct aliases

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linter: `npm run lint`
6. Submit a pull request

## 📄 License

[Your License Here]

## 🔗 Links

- [Databricks](https://www.databricks.com)
- [Databricks Agent Framework](https://docs.databricks.com/aws/en/generative-ai/agent-framework)
- [Vercel AI SDK](https://sdk.vercel.ai)

---

**Built with ❤️ for the Databricks community**

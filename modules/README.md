# Module-Based Architecture

This folder contains the application's core functionality organized by modules. Each module is a self-contained unit that encapsulates related functionality.

## Structure

Each module follows this general structure:

```
module-name/
  ├── index.ts                 # Re-exports module functionality
  ├── models/                  # TypeScript interfaces/types
  ├── services/                # Business logic and API interactions
  ├── components/              # React components (if applicable)
  ├── hooks/                   # React hooks (if applicable)
  └── utils/                   # Utility functions
```

## Current Modules

- `auth` - Authentication functionality (signup, signin, signout)
- `users` - User management (CRUD operations for users)

## Usage

Import modules from the main export:

```typescript
import { authService, usersService } from '@/modules';
```

Or import specific modules:

```typescript
import { authService } from '@/modules/auth';
import { usersService } from '@/modules/users';
```

## Adding New Modules

1. Create a new directory with the module name
2. Create an `index.ts` file that exports the module's functionality
3. Add the module to the main `src/modules/index.ts` export file 
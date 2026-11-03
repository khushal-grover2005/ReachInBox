export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
  }
}

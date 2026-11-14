/**
 * Thin Cloudflare Worker proxy forwarding HTTP traffic to the Django Gunicorn
 * container running on port 8000. Secrets (DATABASE_URL, DJANGO_SECRET_KEY,
 * ODDS_API_KEY) and non-secret vars are forwarded into container envVars.
 */
import { Container, getContainer } from "@cloudflare/containers";

export class MavisDjangoContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "15m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL ?? "",
      DJANGO_SECRET_KEY: env.DJANGO_SECRET_KEY ?? "",
      ODDS_API_KEY: env.ODDS_API_KEY ?? "",
      DJANGO_ALLOWED_HOSTS: env.DJANGO_ALLOWED_HOSTS ?? "*",
      CORS_ALLOWED_ORIGINS:
        env.CORS_ALLOWED_ORIGINS ?? "https://mavis-fantasy-grinder.pages.dev",
    };
  }
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.DJANGO_CONTAINER, "primary");
    return container.fetch(request);
  },
};

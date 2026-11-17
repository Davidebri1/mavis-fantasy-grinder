/**
 * Cloudflare Worker entrypoint for `mavis-fantasy-grinder-api`.
 *
 * When deployed with a Cloudflare Container binding (`env.DJANGO_CONTAINER`),
 * forwards HTTP traffic directly to the Django + Gunicorn container on port 8000.
 * Otherwise serves the built-in Cloudflare Edge API handler (`handleEdgeApiRequest`)
 * with zero Docker or container plan dependency.
 */
import { Container, getContainer } from "@cloudflare/containers";
import { handleEdgeApiRequest } from "./mavis-edge-api.mjs";

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
    if (env?.DJANGO_CONTAINER) {
      const container = getContainer(env.DJANGO_CONTAINER, "primary");
      return container.fetch(request);
    }
    return handleEdgeApiRequest(request, env);
  },
};

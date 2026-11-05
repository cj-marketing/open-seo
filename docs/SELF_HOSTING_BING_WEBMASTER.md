# Bing Webmaster Tools (optional)

OpenSEO can read your Bing search performance, traffic and crawl health through MCP. It uses one Bing API key for the whole deployment (no OAuth) and costs no OpenSEO credits.

## Set up

1. In [Bing Webmaster Tools](https://www.bing.com/webmasters), add and verify your site, or import it from Google Search Console.
2. Open **Settings → API access** and generate an API key.
3. Set `BING_WEBMASTER_API_KEY` in your stack environment (`.env` for the Docker standalone edition).
4. Recreate the services so the key is picked up: `docker compose up -d --force-recreate init web crawl-gateway`.

The key sees every site in that Bing account. For each project, OpenSEO uses the verified Bing site whose host matches the project's domain (`www.`, protocol and trailing slash are ignored). If none matches, the tools list the sites the key can see.

## MCP tools

All tools are read-only.

- `get_bing_search_performance`: clicks, impressions, CTR and average position per query or page. Bing reports weekly rows; they are summed per query or page.
- `get_bing_traffic_trend`: daily impressions, clicks and CTR for the last N days.
- `get_bing_crawl_health`: latest crawl stats, 30-day sums by HTTP status class, and crawl issues (blocked, 4xx/5xx, DNS and timeout errors) sorted by inbound links.

`GET /api/health` and the Docker startup report show whether the key is set.

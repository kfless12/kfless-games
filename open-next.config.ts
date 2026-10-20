/**
 * The Cloudflare Workers build — SPEC.md §16.
 *
 * No incremental cache is configured, and that is deliberate rather than an
 * omission: every route in this app is `force-dynamic` because standings, the
 * queue and the draft are all derived at read time (CLAUDE.md invariant 1), so
 * there is nothing for an ISR cache to hold. Skipping it means no R2 bucket,
 * which SPEC.md §12 rejects anyway.
 */
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();

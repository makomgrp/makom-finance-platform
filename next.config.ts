import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // MILESTONE 26B-9A — KEEP THE MAIL LIBRARIES OUT OF THE BUNDLER.
  //
  // imapflow and mailparser are Node libraries that open raw TLS sockets and
  // pull in Node built-ins through dynamic requires. Bundled, they resolve but
  // do not WORK: the first live sync connected, then hung until the timeout and
  // reported a generic failure, while the identical settings succeeded in a
  // plain Node script seconds earlier. Marking them external makes the server
  // load them from node_modules as-is, which is how they are designed to run.
  serverExternalPackages: ["imapflow", "mailparser"],
  experimental: {
    serverActions: {
      // Milestone 8A: dossier document uploads enforce a 20 MB business
      // limit in application code (see src/lib/services/documents.ts) —
      // this raises the transport-level cap enough to accommodate that
      // plus multipart/form-data overhead, it does not itself define the
      // enforced limit.
      bodySizeLimit: "25mb",
    },
  },
};

export default withNextIntl(nextConfig);

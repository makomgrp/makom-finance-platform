import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
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

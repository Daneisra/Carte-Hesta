# Build ONLY the positive synthetic context produced with prepareFirefoxLinuxContext.js --e1.
# Image downloads and npm installation occur only during the explicit isolated build.
ARG ACTIONLINT_IMAGE=rhysd/actionlint:1.7.11
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.56.0-noble
FROM ${ACTIONLINT_IMAGE} AS actionlint
FROM ${PLAYWRIGHT_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 nginx rsync git shellcheck && rm -rf /var/lib/apt/lists/*
COPY --from=actionlint /usr/local/bin/actionlint /usr/local/bin/actionlint
WORKDIR /work
COPY --chown=pwuser:pwuser . .
ARG CONTEXT_MANIFEST_SHA
RUN node tools/verifyLinuxContext.js /work "$CONTEXT_MANIFEST_SHA" \
    && actionlint -version \
    && touch /tmp/carte-empty-user.npmrc /tmp/carte-empty-global.npmrc \
    && npm ci --ignore-scripts --no-audit --no-fund --userconfig=/tmp/carte-empty-user.npmrc --globalconfig=/tmp/carte-empty-global.npmrc \
    && node tools/verifyLinuxContext.js /work "$CONTEXT_MANIFEST_SHA" --dependencies
RUN chown pwuser:pwuser /work \
    && node -e "if(process.versions.node.split('.')[0]!=='22'||require('playwright/package.json').version!=='1.56.0')process.exit(1)"
USER pwuser
CMD ["node", "tools/runLinuxValidation.js"]

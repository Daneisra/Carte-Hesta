const DEFAULT_ASSET_ARCHIVE_EXCLUDES = ['logs/*', 'icons/README.md'];

const getArchiveDescriptor = method => {
  if (method === 'tar') {
    return {
      filename: 'assets.tar.gz',
      contentType: 'application/gzip'
    };
  }
  return {
    filename: 'assets.zip',
    contentType: 'application/zip'
  };
};

const buildZipArgs = (targetPath, excludes = DEFAULT_ASSET_ARCHIVE_EXCLUDES) => [
  '-r',
  targetPath,
  '.',
  ...excludes.flatMap(pattern => ['-x', pattern])
];

const buildTarArgs = (targetPath, excludes = DEFAULT_ASSET_ARCHIVE_EXCLUDES) => [
  '-czf',
  targetPath,
  ...excludes.map(pattern => `--exclude=${pattern.replace(/\/\*$/u, '')}`),
  '.'
];

const quotePowershellPath = value => `"${String(value).replace(/"/g, '`"')}"`;

const buildPowershellArchiveCommand = (targetPath, excludes = DEFAULT_ASSET_ARCHIVE_EXCLUDES) => [
  'Compress-Archive',
  '-Path', '*',
  '-DestinationPath', quotePowershellPath(targetPath),
  '-Force',
  '-CompressionLevel', 'Optimal',
  ...excludes.flatMap(pattern => ['-Exclude', quotePowershellPath(pattern)])
].join(' ');

module.exports = {
  DEFAULT_ASSET_ARCHIVE_EXCLUDES,
  getArchiveDescriptor,
  buildZipArgs,
  buildTarArgs,
  buildPowershellArchiveCommand
};

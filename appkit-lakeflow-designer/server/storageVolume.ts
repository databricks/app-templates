import { createApp, files } from '@databricks/appkit';
import { uploadStoragePath, type AppStorage } from '../shared/storageConfig';

// AppKit auto-discovers every volume env binding. Deny unrelated handles explicitly, even
// in backend-only instances, instead of inheriting the plugin's default publicRead policy.
export const denyDiscoveredVolumes = () =>
  Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.startsWith('DATABRICKS_VOLUME_') && process.env[key])
      .map((key) => [key.slice('DATABRICKS_VOLUME_'.length).toLowerCase(), { policy: () => false }]),
  );

let pendingVolumeSetup: Promise<unknown> = Promise.resolve();
export function setupStorageVolume<T>(setup: () => Promise<T>): Promise<T> {
  // Discovery happens asynchronously during AppKit setup. Do not add/change env roots while
  // another instance is still discovering them, otherwise its deny-all policies can miss a root.
  const pending = pendingVolumeSetup.then(setup);
  pendingVolumeSetup = pending.catch(() => undefined);
  return pending;
}

export async function createUploadVolume(storage: AppStorage) {
  return setupStorageVolume(async () => {
    // The trusted manifest supplies the optional volume resource. Do not require it in app.yaml:
    // ordinary apps have no upload volume, and an existing app can enable uploads on republish.
    process.env.DATABRICKS_VOLUME_FILES = `/Volumes/${storage.volume.replaceAll('.', '/')}`;
    // A backend-only AppKit instance has no server plugin, so generic /api/files routes cannot
    // bypass the viewer/parameter checks in the Designer routes.
    const appkit = await createApp({
      plugins: [
        files({
          volumes: {
            ...denyDiscoveredVolumes(),
            files: {
              auth: 'service-principal',
              policy: (_action, resource, user) =>
                user.isServicePrincipal === true && resource.path.startsWith(`${uploadStoragePath(storage)}/`),
            },
          },
        }),
      ],
    });
    return appkit.files('files');
  });
}

// AppKit 0.70 embeds paths directly in upload URLs; encode segments so filenames stay literal.
export const encodeStoragePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function parseStorageFileSize(contentLength: unknown): number | undefined {
  // The Files SDK reads Content-Length from an HTTP header, so it is a string at runtime even
  // though AppKit's FileMetadata type currently declares a number.
  const size = Number(contentLength);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

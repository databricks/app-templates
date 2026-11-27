import { describe, it, expect, beforeAll } from 'vitest';
import { files } from '@databricks/appkit';
import { withinVolume } from './files-policy';

/** The same composition server.ts configures for the page-image volume. */
const policy = files.policy.all(withinVolume, files.policy.publicRead());

const user = { id: 'reviewer@example.com', isServicePrincipal: false };
const check = (action: Parameters<typeof policy>[0], path: string) => policy(action, { path, volume: 'files' }, user);

beforeAll(() => {
  process.env.DATABRICKS_VOLUME_FILES = '/Volumes/catalog/schema/page_images';
});

describe('page-image volume policy', () => {
  it('allows reading a page image, which is all the app asks for', async () => {
    await expect(check('raw', 'receipt_1_page_1.png')).resolves.toBe(true);
    await expect(check('read', 'nested/receipt_1_page_1.png')).resolves.toBe(true);
    await expect(check('raw', '/Volumes/catalog/schema/page_images/receipt_1_page_1.png')).resolves.toBe(true);
  });

  it('refuses an absolute path outside the bound volume', async () => {
    await expect(check('raw', '/Volumes/other/schema/secrets/payroll.csv')).resolves.toBe(false);
    await expect(check('list', '/Volumes/catalog/schema/other_volume')).resolves.toBe(false);
    await expect(check('read', '/Volumes/catalog/schema/page_images_other/x.png')).resolves.toBe(false);
  });

  it('refuses traversal out of the volume', async () => {
    await expect(check('raw', '../../other/page.png')).resolves.toBe(false);
    await expect(check('read', '/Volumes/catalog/schema/page_images/../../escape.png')).resolves.toBe(false);
  });

  it('refuses every write action: reviewers only ever look at pages', async () => {
    await expect(check('upload', 'page.png')).resolves.toBe(false);
    await expect(check('delete', 'page.png')).resolves.toBe(false);
    await expect(check('mkdir', 'pages')).resolves.toBe(false);
  });
});

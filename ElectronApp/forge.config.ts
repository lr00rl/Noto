import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const packageVariant = process.env.NTO_PACKAGE_VARIANT;
if (packageVariant !== 'e2e' && packageVariant !== 'release') {
  throw new Error('NTO_PACKAGE_VARIANT must be explicitly set to e2e or release');
}
const e2eFuseVariant = packageVariant === 'e2e';

/**
 * Code signing is configured from the environment so that an unsigned local
 * build and a signed release build run the same packaging path. When the
 * credentials are absent the build still succeeds and simply is not signed,
 * which is what a contributor without certificates needs.
 */
const appleIdentity = process.env.NOTO_APPLE_SIGNING_IDENTITY;
const appleNotarize = process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
  ? {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpack: '**/.vite/build/fs-service.js' },
    extraResource: [
      path.resolve(__dirname, 'resources'),
      path.resolve(__dirname, 'node_modules/electron/dist/LICENSE'),
      path.resolve(__dirname, 'node_modules/electron/dist/LICENSES.chromium.html'),
    ],
    executableName: process.platform === 'linux' ? 'noto' : 'Noto',
    appBundleId: 'dev.lr00rl.noto',
    appCategoryType: 'public.app-category.productivity',
    name: 'Noto',
    // Windows file properties, so the binary is not anonymous in Task Manager
    // or in the installer's publisher field.
    win32metadata: {
      CompanyName: 'Noto',
      FileDescription: 'Noto Markdown editor',
      ProductName: 'Noto',
      'requested-execution-level': 'asInvoker',
    },
    ...(appleIdentity
      ? {
          osxSign: {
            identity: appleIdentity,
            optionsForFile: () => ({ entitlements: path.resolve(__dirname, 'resources/entitlements.plist') }),
          },
        }
      : {}),
    ...(appleNotarize ? { osxNotarize: appleNotarize } : {}),
  },
  rebuildConfig: {},
  makers: [
    /*
     * macOS ships as a zip rather than a DMG.
     *
     * `@electron-forge/maker-dmg` pulls in `appdmg`, which needs the native
     * `macos-alias` module. That module last shipped in 2015 and does not build
     * on Node 22 arm64, so adding it would break packaging on every platform to
     * gain a nicer mount window on one. A zip is a supported macOS distribution
     * format and is what update feeds consume anyway. A DMG can come back
     * through a maintained tool without disturbing this config.
     */
    new MakerZIP({}, ['darwin']),
    // Windows: Squirrel produces the installer and the delta packages.
    new MakerSquirrel({
      name: 'Noto',
      setupExe: 'NotoSetup.exe',
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    }, ['win32']),
    // Linux: both major package formats rather than picking a side.
    new MakerDeb({
      options: {
        name: 'noto',
        productName: 'Noto',
        genericName: 'Markdown Editor',
        categories: ['Office', 'Utility'],
        mimeType: ['text/markdown'],
      },
    }, ['linux']),
    new MakerRpm({
      options: {
        name: 'noto',
        productName: 'Noto',
        genericName: 'Markdown Editor',
        categories: ['Office', 'Utility'],
        mimeType: ['text/markdown'],
      },
    }, ['linux']),
  ],
  plugins: [
    new VitePlugin({
      concurrent: 2,
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
        { entry: 'src/preload/plugin-preload.ts', config: 'vite.plugin-preload.config.mts', target: 'preload' },
        { entry: 'src/service/fs-service.ts', config: 'vite.service.config.mts', target: 'main' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.mts' },
        { name: 'plugin_runtime', config: 'vite.plugin-runtime.config.mts' },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // The e2e variant needs the inspect arguments Playwright attaches with.
      // Release must never allow them.
      [FuseV1Options.EnableNodeCliInspectArguments]: e2eFuseVariant,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

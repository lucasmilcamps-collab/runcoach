import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML document for the web/PWA build (runs only in Node during static
 * export, never in the browser). Carries the PWA manifest and the iOS
 * "Add to Home Screen" meta so the deployed site installs as a standalone app
 * on iPhone — same Night-Trail identity, no Safari chrome.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the app draw under the notch; SafeAreaView
            handles the insets. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        <title>Mosa</title>
        <meta
          name="description"
          content="Coach de course adaptatif : des plans IA qui s'ajustent à votre récupération réelle (Garmin)."
        />

        {/* Installable PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14140F" />

        {/* iOS standalone home-screen app */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Mosa" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" href="/icons/favicon-32.png" />

        <ScrollViewStyleReset />

        {/* Night Ground everywhere so there's no white flash on launch or when
            the standalone app rubber-bands past its content. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              'html,body,#root{background-color:#14140F;}body{overscroll-behavior-y:none;}',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

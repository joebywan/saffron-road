package dev.local.saffronroad;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewFeature;

/**
 * The whole app: one activity holding one WebView that shows the web app out
 * of the APK's assets.
 *
 * <h2>Why not file://</h2>
 *
 * The game is plain ES modules — {@code <script type="module">} plus a graph
 * of {@code import} statements — and every browser, WebView included, treats
 * a {@code file://} document as an opaque origin and refuses to load modules
 * into it. A file:// build would therefore need the single-file bundle
 * instead, which is a different and lesser artefact.
 *
 * <p>So the assets are served over a virtual origin instead.
 * {@link WebViewAssetLoader} answers requests for
 * {@code https://appassets.androidplatform.net/} out of {@code assets/}, from
 * inside the process, with no socket and no permission. That buys three
 * things at once:
 *
 * <ul>
 *   <li>a real https origin, so ES modules load exactly as they do on a
 *       server;</li>
 *   <li>a <em>secure context</em>, so the service worker in {@code sw.js}
 *       registers and the existing offline machinery runs unchanged;</li>
 *   <li>an origin with a stable host, so {@code localStorage} survives
 *       reinstalls of the page and the app's saved setup persists.</li>
 * </ul>
 *
 * <p>{@code androidplatform.net} is reserved by Google for exactly this and
 * is guaranteed never to resolve on the public internet, so a miss cannot
 * silently become a real request.
 *
 * <h2>The service-worker interception is not optional</h2>
 *
 * A service worker's own fetches do <em>not</em> pass through
 * {@link android.webkit.WebViewClient#shouldInterceptRequest}. They go
 * through the service worker client instead, which is why
 * {@link ServiceWorkerControllerCompat} is wired to the same asset loader
 * below. Without it {@code sw.js} would install with an empty cache.
 */
public final class MainActivity extends ComponentActivity {

    /** Reserved by Google for app-served assets; never resolves publicly. */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";

    /** --bg-panel from the dark palette in styles.css. Matches the topbar. */
    private static final int COLOR_PANEL = 0xFF19202B;
    /** --bg from the dark palette. Matches the board behind everything. */
    private static final int COLOR_BG = 0xFF0E1219;

    /** How long a first BACK press counts as "I meant it" for the second. */
    private static final long EXIT_WINDOW_MS = 2000L;

    private WebView webView;
    private long lastBackPress = 0L;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Debug builds only. This is what lets `chrome://inspect` reach the
        // page, which is the only practical way to debug the web app in situ
        // once it is inside an APK.
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(COLOR_BG);
        configure(webView.getSettings());
        webView.setWebViewClient(new LocalAssetClient(assetLoader));
        wireServiceWorker(assetLoader);

        setContentView(buildLayout(webView));
        installBackHandler();

        // A board game is minutes of staring at the table between taps. The
        // screen going out mid-think is the single most annoying thing a
        // WebView game can do.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    /* ------------------------------------------------------------------ */
    /* WebView configuration                                               */
    /* ------------------------------------------------------------------ */

    private void configure(WebSettings s) {
        // The app is JavaScript and localStorage and nothing else.
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);

        // Nothing here is meant to be pinch-zoomed: the layout is responsive
        // and every control is already at least 44x44 CSS px on touch.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // NORMAL, not TEXT_AUTOSIZING: font boosting rewrites computed sizes
        // and would shove the token piles out of their grid. The page sets
        // its own type scale and honours the viewport meta tag.
        s.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NORMAL);
        s.setTextZoom(100);

        // The origin is https and everything on it is served from the APK, so
        // there is no legitimate mixed content — only a mistake.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // No file:// and no content:// reachable from the page. The asset
        // loader is the only way in, and it only ever hands back assets/.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        // The page ships `<meta name="color-scheme" content="light dark">`
        // and a full dark palette, so WebView hands it prefers-color-scheme:
        // dark (the app theme sets android:isLightTheme=false) and lets the
        // page's own CSS do the work rather than algorithmically inverting it.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }
    }

    /**
     * Point the service worker at the same asset loader. Guarded on the
     * feature because it depends on the WebView implementation shipped by the
     * device, not on the SDK this was compiled against; where it is missing
     * the app still runs, just without the (redundant, here) offline cache.
     */
    private void wireServiceWorker(WebViewAssetLoader assetLoader) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)
                || !WebViewFeature.isFeatureSupported(
                        WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            return;
        }
        ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                new ServiceWorkerClientCompat() {
                    @Override
                    @Nullable
                    public WebResourceResponse shouldInterceptRequest(
                            @NonNull WebResourceRequest request) {
                        return assetLoader.shouldInterceptRequest(request.getUrl());
                    }
                });
    }

    /** Serves the APK's assets, and refuses to navigate anywhere else. */
    private final class LocalAssetClient extends WebViewClientCompat {
        private final WebViewAssetLoader loader;

        LocalAssetClient(WebViewAssetLoader loader) {
            this.loader = loader;
        }

        @Override
        @Nullable
        public WebResourceResponse shouldInterceptRequest(
                @NonNull WebView view, @NonNull WebResourceRequest request) {
            return loader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(
                @NonNull WebView view, @NonNull WebResourceRequest request) {
            Uri url = request.getUrl();
            if (ASSET_HOST.equals(url.getHost())) return false;
            // The app has no outbound links today. If one is ever added it
            // opens in the user's browser rather than turning this WebView
            // into an uncontrolled one with no address bar.
            if ("http".equals(url.getScheme()) || "https".equals(url.getScheme())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (ActivityNotFoundException ignored) {
                    // No browser installed. Nothing sensible to do.
                }
            }
            return true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Layout, insets and system bars                                      */
    /* ------------------------------------------------------------------ */

    /**
     * The WebView is inset out of the system bars and the display cutout by
     * hand rather than being left to the page's {@code env(safe-area-inset-*)}
     * rules.
     *
     * <p>Those rules stay in the CSS and stay correct — in a browser they are
     * what keeps the header out from under a notch. Inside a WebView the
     * values are only ever populated for the cutout, never for the status or
     * navigation bar, and from targetSdk 35 the window is edge-to-edge whether
     * the app asks for it or not. Insetting the view is the only thing that
     * covers both. WebView computes its cutout safe area from where it
     * actually sits on screen, so a WebView already clear of the notch reports
     * zero and the CSS adds nothing on top: no double padding.
     */
    private View buildLayout(WebView web) {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(web, webParams);

        // A strip the exact height of the status bar, painted the colour of
        // the page's own topbar, so the bar reads as part of the app instead
        // of as a black band above it.
        View statusScrim = new View(this);
        statusScrim.setBackgroundColor(COLOR_PANEL);
        FrameLayout.LayoutParams scrimParams =
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0);
        root.addView(statusScrim, scrimParams);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars =
                WindowCompat.getInsetsController(getWindow(), root);
        // Dark bars behind light glyphs, matching the dark palette.
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets safe = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                            | WindowInsetsCompat.Type.ime());
            FrameLayout.LayoutParams lp =
                    (FrameLayout.LayoutParams) web.getLayoutParams();
            lp.setMargins(safe.left, safe.top, safe.right, safe.bottom);
            web.setLayoutParams(lp);

            statusScrim.getLayoutParams().height = safe.top;
            statusScrim.requestLayout();
            return insets;
        });

        return root;
    }

    /* ------------------------------------------------------------------ */
    /* Back button                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * BACK goes back in the page's history if there is any, and otherwise
     * needs a second press within {@link #EXIT_WINDOW_MS} to leave.
     *
     * <p>A single press dropping you out of a half-played game — with bots
     * mid-think and a board you cannot get back — is the classic WebView-app
     * mistake, and it is worse here because the game state lives in memory.
     *
     * <p>This is registered on the {@code OnBackPressedDispatcher}, not on
     * {@code onBackPressed()}: from targetSdk 36 predictive back is on by
     * default and the old override is simply never called.
     */
    private void installBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                long now = System.currentTimeMillis();
                if (now - lastBackPress < EXIT_WINDOW_MS) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                }
                lastBackPress = now;
                Toast.makeText(MainActivity.this, R.string.press_back_again, Toast.LENGTH_SHORT)
                        .show();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Lifecycle                                                           */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        webView.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.resumeTimers();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        // Detach before destroy, or the WebView takes the window down with it.
        ((ViewGroup) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}

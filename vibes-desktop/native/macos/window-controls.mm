#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static NSWindow* getMainWindow() {
    return [[NSApplication sharedApplication] mainWindow]
        ?: [[[NSApplication sharedApplication] windows] firstObject];
}

extern "C" {

static void hideZoomButtonWithRetry(int retryCount);

void hideZoomButton(void) {
    hideZoomButtonWithRetry(0);
}

static void hideZoomButtonWithRetry(int retryCount) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = getMainWindow();
        if (!window) return;

        @try {
            [[window standardWindowButton:NSWindowCloseButton] setHidden:YES];
            [[window standardWindowButton:NSWindowZoomButton] setHidden:YES];
            [[window standardWindowButton:NSWindowMiniaturizeButton] setHidden:YES];
        } @catch (NSException *exception) {
            // Window not ready — _postWindowNeedsToResetDragMargins throws
            // if called before the window is fully initialized.
            if (retryCount < 5) {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                    (int64_t)(200 * NSEC_PER_MSEC)),
                    dispatch_get_main_queue(), ^{
                        hideZoomButtonWithRetry(retryCount + 1);
                    });
            }
        }
    });
}


} // extern "C"

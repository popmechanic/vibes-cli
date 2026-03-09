#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static NSWindow* getMainWindow() {
    return [[NSApplication sharedApplication] mainWindow]
        ?: [[[NSApplication sharedApplication] windows] firstObject];
}

extern "C" {

void hideZoomButton(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = getMainWindow();
        if (!window) return;

        [[window standardWindowButton:NSWindowZoomButton] setHidden:YES];
        [[window standardWindowButton:NSWindowMiniaturizeButton] setHidden:YES];
    });
}


} // extern "C"

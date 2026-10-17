<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# UI thread confinement

`ui-thread-confinement` · practices, design

UI state and widgets are touched only from the one thread or event loop that owns them, and anything slow or blocking (network, disk, heavy computation, waiting) runs elsewhere and hands its result back to that thread as a message or posted task.

*Names:* "Thread confinement" as a named technique goes back to Doug Lea's Concurrent Programming in Java (2nd edition, 1999, section 2.3, confinement within threads). Brian Goetz's Java Concurrency in Practice (2006, section 3.3 and chapter 9) made it widely known and names Swing's single-threaded event model as the standard example. Each toolkit states the rule in its own docs: Swing's Event Dispatch Thread rule (Oracle's Swing tutorial, "Concurrency in Swing"), Android's single-thread model ("don't block the UI thread; don't touch the UI toolkit from outside it") with StrictMode and the ANR dialog to enforce it, WPF's Dispatcher and thread affinity, JavaFX's application thread, and the browser's main thread with Web Workers for heavy work. In event-loop servers and TUIs the same rule is "don't block the event loop". Also called UI-thread affinity or the single-threaded UI rule.

*Matters most for:* tui, desktop, mobile, web-frontend, games

## But

Single-threaded confinement is a design choice with costs. Some frameworks make parts of the UI thread-safe, or render on a separate thread (Flutter's raster thread, browsers' compositor), and then the rule applies only to the parts they say. For short scripts, prototypes and one-shot CLIs with no event loop, a blocking call is simply the clearest code. Moving work off the UI thread brings cancellation, ordering and stale-result problems, so a short synchronous step with a spinner can beat a poorly managed background task. Multithreaded UI toolkits have been tried; Graham Hamilton's essay on them ("Multithreaded toolkits: A failed dream?") is the usual explanation of why the field settled on one thread.

## Quality axes

- **reliability** ⊕ (primary): Widgets and UI state are never touched from two threads, which removes rare races, rendering glitches and crashes.
- **runtime** ⊕ (primary): Slow network, disk or computation runs off the UI thread, so the interface stays responsive instead of freezing.
- **delivery** −: Background work needs a handoff back to the UI thread, plus cancellation and handling of stale results.

**Flips:** Moving trivial work off the thread, or spawning work without cancellation, brings ordering and stale-result bugs, so reliability turns "-". For short scripts and one-shot CLIs a blocking call is the clearest code.

## Warranted when

- The toolkit is single-threaded and not thread-safe, as nearly all UI toolkits are.
- Handlers do network, disk or subprocess work whose latency varies, so the UI freezes on a slow day.
- Results from background work have to update what the user sees.
- Bugs that appear only under load or on slow machines, which is how races on UI state show up.

## How it shows

- Helpers that post work to the UI thread (runOnUiThread, View.post, invokeLater, Platform.runLater, Dispatcher.Invoke, call_from_thread, Program.Send) at the points where background results come back.
- Assertions or guards that the caller is on the UI thread (isEventDispatchThread, Looper checks, CheckAccess, an assertOnUIThread helper).
- Worker or background abstractions (SwingWorker, coroutines on an IO dispatcher, Web Workers, tea.Cmd, spawn_blocking) that take slow work off the loop.
- Before the fix, network or file calls inside click or key handlers, and freezes or "not responding" reports when a call is slow.
- Before the fix, worker threads or goroutines that write straight into widget or model fields, with rare, unreproducible rendering glitches or crashes.

## Overdone when

- Moving trivial, fast work off the UI thread, so a simple handler becomes a round trip through a worker and a callback with ordering bugs of its own.
- Spawning a thread per action with no cancellation, so stale results arrive after the user has moved on and overwrite newer state.
- Wrapping every call in a hop to the UI thread "to be safe", including from code already on it, which hides where the boundary really is.

## Example

Before:

```
class RatesPanel:
    fn on_refresh_clicked():
        rates = http.get(RATES_URL).json()   # freezes the window while it waits
        self.table.show(rates)

    fn start_auto_refresh():
        spawn_thread(fn():
            loop:
                self.table.show(http.get(RATES_URL).json())   # widget touched off the UI thread
                sleep(60))
```

After:

```
class RatesPanel:
    fn on_refresh_clicked():
        self.spinner.show()
        background.run(fetch_rates, on_done=self.rates_arrived)

    fn start_auto_refresh():
        ui_timer.every(60, self.on_refresh_clicked)   # timer fires on the UI thread

    fn rates_arrived(rates: Rates):          # called on the UI thread
        self.spinner.hide()
        self.table.show(rates)

fn fetch_rates() -> Rates:                     # runs on a worker; touches no widgets
    return http.get(RATES_URL).json()
```

Slow work runs on a worker and only the result crosses back, so the window stays responsive and only the UI thread ever writes to widgets.

## One-file tell

Written for python and rust, for event-loop blocking only. Inside an async function: time.sleep, a blocking HTTP call (requests, urllib, httpx.Client) or subprocess.run/check_output in Python; std::thread::sleep, reqwest::blocking or std::process::Command::output in Rust. (Ruff's flake8-async rules check the Python form.) Not when the call is wrapped in asyncio.to_thread, run_in_executor or spawn_blocking, and not file reads, which are usually short and too common at startup to flag.

## By language

**python:** tkinter, Qt and most GUI toolkits require widget calls from the main thread; use a queue polled with after(), Qt signals across threads, or Textual's workers and call_from_thread. In asyncio code a blocking call (time.sleep, requests, a sync database driver) stalls the whole loop; use asyncio.to_thread or an async client.

**typescript:** The browser main thread runs both scripts and rendering, so long synchronous work causes jank; split it, or move it to a Web Worker that posts messages back. Node's event loop has the same rule for servers and CLIs: avoid the Sync variants of fs, crypto and child_process on hot paths.

**java:** Swing: touch components only on the EDT, using invokeLater and SwingWorker. JavaFX: Platform.runLater and Task. Android: the main thread owns views, StrictMode flags disk and network on it, and coroutines on Dispatchers.IO or an Executor do the slow work.

**csharp:** WPF and WinForms controls have thread affinity; marshal with Dispatcher.InvokeAsync or Control.Invoke. await in a UI handler resumes on the UI thread through its SynchronizationContext, so async is the usual way to keep it free. Blocking on .Result or .Wait() from the UI thread is the classic deadlock; libraries use ConfigureAwait(false) to avoid it.

**go:** Go has no main thread by default, but GUI bindings often need one (macOS requires the main OS thread, so runtime.LockOSThread in init), and Fyne asks for fyne.Do from other goroutines. In Bubble Tea, Update and View run on the program's goroutine; slow work goes in a tea.Cmd, and other goroutines report back with Program.Send, never by mutating the model.

**rust:** Many toolkits make UI handles !Send, so the compiler enforces confinement (gtk-rs objects; use glib::MainContext::spawn_local or channels). winit's event loop must run on the main thread on some platforms. In tokio, blocking inside async code stalls a worker; use spawn_blocking.

## Related

[Observer](observer.md) · [Model-View-Update (The Elm Architecture)](model-view-update.md) · [Functional Core, Imperative Shell](functional-core-imperative-shell.md) · [Immutability by Default](immutability-by-default.md) · [Global state](global-state.md) · [Resource Leak](resource-leak.md)

## Sources

- [Android Developers, Processes and threads overview, threads (the single-thread model)](https://developer.android.com/guide/components/processes-and-threads) (read)
- [Oracle, The Java Tutorials, Concurrency in Swing, The Event Dispatch Thread](https://docs.oracle.com/javase/tutorial/uiswing/concurrency/dispatch.html) (read)
- [Doug Lea, Concurrent Programming in Java, 2nd ed. (1999), 2.3.2 Confinement Within Threads](https://gee.cs.oswego.edu/dl/cpj/s2.3.html) (recalled)
- [Brian Goetz et al., Java Concurrency in Practice (2006), 3.3 Thread confinement and 9 GUI applications](https://jcip.net/) (recalled)
- [Microsoft Learn, WPF Threading Model (Dispatcher)](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/threading-model) (recalled)
- [MDN, Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) (recalled)
- Graham Hamilton, Multithreaded toolkits, A failed dream? (2004) (recalled)

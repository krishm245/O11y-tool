# Architecture

O11y Replay has three apps and three shared packages. A Session starts in the
Chrome extension, persists through the local API, and plays in the web app.
All recording data stays on the local machine.

## System map

```text
                         @app-o11y/protocol
                    HTTP types and validation
                               |
         +---------------------+---------------------+
         |                     |                     |
         v                     v                     v
+------------------+   HTTP   +----------------+   HTTP   +----------------+
| Chrome extension |--------->| local API      |<---------| web app        |
|                  |          |                |          |                |
| popup            |          | Session store  |          | library        |
| background       |          | artifact store |          | player         |
| page recorder    |          +-------+--------+          +----------------+
| video recorder   |                  |
+------------------+                  v
                              +---------------+
                              | local data    |
                              | SQLite + disk |
                              +---------------+
```

`@app-o11y/privacy` sanitizes page data before the extension queues it.
`@app-o11y/session-clock` calculates active recording time across pauses.

## Extension modules

The background module owns the recording lifecycle. It connects browser
adapters to the recording coordinator and sends artifacts to the local API.

```text
popup
  |
  | RecordingCommand
  v
+------------------------------------------------------+
| browser-messages                                     |
|                                                      |
| validates unknown values once at the browser seam    |
| returns discriminated unions with inferred fields    |
+----------------------------+-------------------------+
                             |
                             v
                  +-----------------------+
                  | background            |
                  | recording coordinator |
                  +-----+------------+----+
                        |            |
           CaptureCommand            | PageRecorderCommand
                        |            |
                        v            v
               +------------+  +---------------+
               | offscreen  |  | page recorder |
               | video      |  | safe events   |
               +------------+  +---------------+
```

`browser-messages.ts` is the interface for extension messages.

The recording coordinator is a deep module. Its small command interface hides
start, pause, resume, stop, failure, and recovery sequencing. Browser calls,
HTTP calls, storage, and tab capture enter through adapters. Tests replace those
adapters without loading Chrome.

## Recording flow

```text
user starts
    |
    v
background creates Session
    |
    +--> offscreen recorder --> WebM chunks ----+
    |                                           |
    +--> page recorder -------> event batches --+--> upload queue
                                                    |
                                                    v
                                               local API
                                                    |
                         +--------------------------+-------------------+
                         |                                              |
                         v                                              v
                  SQLite manifest                               artifact files
```

The Session clock assigns active time to video chunks and events. Leaving the
recorded origin pauses both recorders. Returning to the origin resumes them on
the same clock.

## Local API modules

```text
HTTP request
    |
    v
+----------------+       +----------------+       +----------------+
| Fastify app    |------>| Session store  |------>| SQLite         |
| route adapter  |       | lifecycle      |       | manifests      |
+-------+--------+       +----------------+       +----------------+
        |
        +--------------->+----------------+------>+----------------+
                         | artifact store |       | chunk files    |
                         | integrity      |       | final video    |
                         +----------------+       +----------------+
```

The Fastify app is the HTTP adapter. Protocol parsers validate request bodies
at that seam. The Session store owns lifecycle transitions and SQLite access.
The artifact store owns checksums, chunk order, capacity limits, and file paths.

Some operations still span both storage modules in the Fastify adapter. Event
upload updates an artifact and then updates Session byte counts. Video
completion and deletion also touch both modules. A future pass should deepen
one local recording module around those operations. That would improve locality
and keep partial writes behind one interface.

## Web app modules

```text
local API --> session library --> App --> SessionPlayer
                    |                       |
                    |                       +--> replay model
                    v
             protocol parsers
```

The session library is the HTTP adapter for the web app. The replay model owns
timeline filtering, labels, pause calculations, and event details. React
modules render the inferred model and keep transport validation out of views.

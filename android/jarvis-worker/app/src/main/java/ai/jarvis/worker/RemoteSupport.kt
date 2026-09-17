package ai.jarvis.worker

object RemoteSupport {
    fun available(api: Int, accessibility: Boolean, projection: Boolean): Boolean =
        api >= 26 && accessibility && (api >= 30 || projection)

    fun updateIdle(enrolled: Boolean, working: Boolean, visible: Boolean, projection: Boolean,
                   elapsed: Long, lastRemote: Long, manual: Boolean): Boolean =
        enrolled && !working && (manual || !visible) && !projection &&
            elapsed >= lastRemote && elapsed - lastRemote > 60_000
}

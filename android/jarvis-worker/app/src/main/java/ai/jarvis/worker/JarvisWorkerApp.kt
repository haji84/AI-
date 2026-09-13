package ai.jarvis.worker

import android.app.Application

class JarvisWorkerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        runCatching { JarvisCommandService.start(this) }
    }
}

plugins { id("com.android.application") }

android {
    namespace = "app.goriq.remote.vmprobe"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.goriq.remote.vmprobe"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "1-vm-only"
    }
}

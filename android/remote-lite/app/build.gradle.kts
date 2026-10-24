plugins { id("com.android.application") }

android {
    namespace = "app.goriq.remote.lite"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.goriq.remote.lite"
        minSdk = 28
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0-dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("debug").res.srcDir("build/generated/vm-res")
    // Physical acceptance over an explicitly configured USB HTTPS loopback.
    // Separate package; normal service/ICE, no emulator-only debug components.
    buildTypes.create("physicalCheck") {
        initWith(buildTypes.getByName("release"))
        applicationIdSuffix = ".physicaltest"
        isDebuggable = false
        signingConfig = signingConfigs.getByName("debug")
        matchingFallbacks += "release"
    }
    sourceSets.getByName("physicalCheck").res.srcDir("build/generated/vm-res")
}

dependencies {
    implementation("io.github.webrtc-sdk:android:150.7871.01")
    testImplementation("junit:junit:4.13.2")
}

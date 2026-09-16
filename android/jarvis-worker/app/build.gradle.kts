plugins {
    id("com.android.application")
}

android {
    buildFeatures { buildConfig = true }
    namespace = "ai.jarvis.worker"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.jarvis.worker"
        minSdk = 28
        targetSdk = 37
        versionCode = 15
        versionName = "0.4.2"
        // Non-secret installation origin. Generic distribution deliberately has no guessed host.
        val bootstrap = providers.gradleProperty("jarvisBootstrapUrl").orElse("").get()
        require(bootstrap.isEmpty() || Regex("https://[A-Za-z0-9.-]+(:[0-9]+)?/?").matches(bootstrap))
        buildConfigField("String", "ENROLLMENT_BOOTSTRAP_URL", "\"$bootstrap\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}

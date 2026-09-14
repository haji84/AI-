plugins {
    id("com.android.application")
}

android {
    namespace = "ai.jarvis.worker"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.jarvis.worker"
        minSdk = 28
        targetSdk = 37
        versionCode = 14
        versionName = "0.4.1"

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
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
}

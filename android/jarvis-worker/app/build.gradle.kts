import java.net.URI
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

plugins {
    id("com.android.application")
}

val installationResources = layout.buildDirectory.dir("generated/res/jarvisInstallation")
val installationOrigin = providers.gradleProperty("jarvisBootstrapUrl").orElse("")
val installationCertificate = providers.gradleProperty("jarvisCaCertificate").orElse("")
val generateInstallationResources = tasks.register("generateInstallationResources") {
    inputs.property("origin", installationOrigin)
    inputs.property("certificatePath", installationCertificate)
    if (installationCertificate.get().isNotBlank()) inputs.file(installationCertificate.get())
    outputs.dir(installationResources)
    doLast {
        val root = installationResources.get().asFile
        val xml = root.resolve("xml/jarvis_network_security.xml")
        xml.parentFile.mkdirs()
        val certificatePath = installationCertificate.get()
        val domainConfig = if (certificatePath.isNotBlank()) {
            val uri = URI(installationOrigin.get())
            require(uri.scheme == "https" && !uri.host.isNullOrBlank())
            val bytes = file(certificatePath).readBytes()
            val certificate = CertificateFactory.getInstance("X.509")
                .generateCertificate(bytes.inputStream()) as X509Certificate
            certificate.checkValidity()
            val raw = root.resolve("raw/jarvis_installation_ca.cer")
            raw.parentFile.mkdirs()
            raw.writeBytes(certificate.encoded)
            """<domain-config cleartextTrafficPermitted="false"><domain includeSubdomains="false">${uri.host}</domain><trust-anchors><certificates src="@raw/jarvis_installation_ca"/></trust-anchors></domain-config>"""
        } else ""
        xml.writeText("""<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system"/></trust-anchors></base-config>$domainConfig</network-security-config>""")
    }
}
tasks.configureEach { if (name == "preBuild") dependsOn(generateInstallationResources) }

android {
    buildFeatures { buildConfig = true }
    // AGP 9 SourceSet accepts a concrete directory; preBuild carries the task dependency above.
    sourceSets.getByName("main").res.srcDir(installationResources.get().asFile)
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

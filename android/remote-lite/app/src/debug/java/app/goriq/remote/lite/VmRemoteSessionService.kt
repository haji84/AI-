package app.goriq.remote.lite

/** Disposable emulator only; its host-loopback alias reaches a loopback-only TURN listener. */
class VmRemoteSessionService : RemoteSessionService() {
    override fun iceConfiguration(access: DeviceSessionAccess, session: String): NativeIceConfig {
        val signed = super.iceConfiguration(access, session)
        return NativeIceConfig(signed.servers, relayOnly = true,
            credentialDeadlineElapsed = signed.credentialDeadlineElapsed)
    }
}

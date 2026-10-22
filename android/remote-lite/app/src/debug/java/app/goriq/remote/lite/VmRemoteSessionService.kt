package app.goriq.remote.lite

import org.webrtc.PeerConnection

/** Disposable emulator only; its host-loopback alias reaches a loopback-only TURN listener. */
class VmRemoteSessionService : RemoteSessionService() {
    override fun iceConfiguration() = NativeIceConfig(listOf(
        PeerConnection.IceServer.builder("turn:10.0.2.2:43478?transport=tcp")
            .setUsername("remote-lite-vm").setPassword("public-vm-fixture-only")
            .createIceServer()), relayOnly = true)
}

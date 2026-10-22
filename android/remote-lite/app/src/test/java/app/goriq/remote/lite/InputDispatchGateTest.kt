package app.goriq.remote.lite

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class InputDispatchGateTest {
    @Test fun noNewOsDispatchAfterStopReturns() {
        val gate = InputDispatchGate()
        var dispatched = 0
        assertTrue(gate.emit { dispatched++; true })
        gate.close()
        assertFalse(gate.emit { dispatched++; true })
        assertEquals(1, dispatched)
    }

    @Test fun stopWaitsForAnAlreadyIssuedCommandButBlocksEveryLaterCommand() {
        val gate = InputDispatchGate()
        val inside = CountDownLatch(1)
        val release = CountDownLatch(1)
        val stopped = CountDownLatch(1)
        val dispatched = AtomicInteger()
        val input = Thread {
            gate.emit {
                inside.countDown()
                check(release.await(2, TimeUnit.SECONDS))
                dispatched.incrementAndGet()
                true
            }
        }
        input.start()
        assertTrue(inside.await(2, TimeUnit.SECONDS))
        val stop = Thread { gate.close(); stopped.countDown() }
        stop.start()
        assertFalse(stopped.await(50, TimeUnit.MILLISECONDS))
        release.countDown()
        assertTrue(stopped.await(2, TimeUnit.SECONDS))
        assertFalse(gate.emit { dispatched.incrementAndGet(); true })
        input.join(2_000); stop.join(2_000)
        assertEquals(1, dispatched.get())
    }
}

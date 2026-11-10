package com.example

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class TimestampCameraUnitTest {

    @Test
    fun `verify string resource exists`() {
        assertNotNull(R.string.app_name)
        assertEquals(true, R.string.app_name > 0)
    }

    @Test
    fun `verify TimeStamp Camera package constants are correct`() {
        assertEquals("com.jeyluta.timestampcamerafree", MainActivity.TIMESTAMP_CAMERA_FREE_PKG)
        assertEquals("com.jeyluta.timestampcamera", MainActivity.TIMESTAMP_CAMERA_PRO_PKG)
        assertEquals("market://details?id=com.jeyluta.timestampcamerafree", MainActivity.TIMESTAMP_CAMERA_PLAY_URL)
        assertEquals("https://play.google.com/store/apps/details?id=com.jeyluta.timestampcamerafree", MainActivity.TIMESTAMP_CAMERA_WEB_URL)
    }
}

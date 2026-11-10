package com.example

import org.junit.Assert.*
import org.junit.Test

/**
 * Example local unit test, which will execute on the development machine (host).
 *
 * See [testing documentation](http://d.android.com/tools/testing).
 */
class ExampleUnitTest {
  @Test
  fun addition_isCorrect() {
    assertEquals(4, 2 + 2)
  }

  @Test
  fun testSafeFilenameRegex() {
    val rawName = "PM_Site/A:Test*Hop?File<Name>|End.xlsx"
    val safeName = rawName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    assertEquals("PM_Site_A_Test_Hop_File_Name__End.xlsx", safeName)
  }

  @Test
  fun testSubfolderSanitization() {
    val subFolder = "/Site_name/Tsimbazaza/"
    val cleanSub = subFolder.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_").trim('/')
    assertEquals("_Site_name_Tsimbazaza_", cleanSub)
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');

    const ss = SpreadsheetApp.openById('1iFf_KSzgvK38FRQBkUNHs49CKmdxFSiFnYPY2nSS_ww');
    const sheet = ss.getSheetByName('sheet1'); // ชื่อแท็บต้องตรง

    sheet.appendRow([
      new Date(),                            // ลำดับ: Timestamp ที่จะใช้บันทึกเวลา
      data.mru || '',                        // MRU
      data.sequenceNumber || '',             // Sequence No.
      data.userNumber || '',                 // User Number (หมายเลขผู้ใช้ไฟ)
      data.installation || '',                // Installation (การติดตั้ง)
      data.name || '',                       // Name
      data.address || '',                    // Address
      data.peaNumber || '',                  // PEA Number (หมายเลข PEA)
      data.dataSequence || '',               // Data Sequence (ลำดับข้อมูล)
      data.manufacturer || '',               // Manufacturer (บริษัทผู้ผลิต)
      data.equipmentType || '',              // Equipment Type (ประเภทอุปกรณ์)
      data.phaseWireVoltage || '',           // Phase, Wire, Voltage / Pressure (เฟส สาย โวลต์ / แรงดัน)
      data.ampereRatio || '',                // Ampere/Ratio (แอมป์/อัตราส่วน)
      data.installationDate || '',           // Installation Date (วันที่ติดตั้ง)
      data.value || '',                      // Value (ค่า)
      data.code || '',                       // Code (รหัส)
      data.withdrawalDate || '',             // Withdrawal Date (วันที่ถอนคืน)
      data.withdrawalUnit || '',             // Withdrawal Unit (หน่วยถอนคืน)
      data.withdrawalReason || '',           // Withdrawal Reason (สาเหตุถอนคืน)
      data.changeoverReason || '',           // Changeover Reason (สาเหตุสับเปลี่ยน)
      data.installationReason || '',         // Installation Reason (สาเหตุการติดตั้ง)
      data.batchStock || ''                  // Batch Stock (แบทช์สต็อค)
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


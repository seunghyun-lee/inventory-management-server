const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const db = require('../db');

router.get('/export-excel', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const inboundData = await db.all(`
            SELECT 
                'inbound' as type,
                i.date, 
                i.supplier as company,
                it.item_name,
                i.total_quantity,
                it.item_subname,
                it.manufacturer,
                i.warehouse_name,
                i.warehouse_shelf,
                i.description,
                i.handler_name
            FROM inbound i
            JOIN items it ON i.item_id = it.id
            WHERE i.date BETWEEN $1 AND $2
        `, [startDate, endDate]);

        const outboundData = await db.all(`
            SELECT 
                'outbound' as type,
                o.date, 
                o.client as company,
                it.item_name,
                o.total_quantity,
                it.item_subname,
                it.manufacturer,
                o.warehouse_name,
                o.warehouse_shelf,
                o.description,
                o.handler_name
            FROM outbound o
            JOIN items it ON o.item_id = it.id
            WHERE o.date BETWEEN $1 AND $2
        `, [startDate, endDate]);

        const allData = [...inboundData, ...outboundData].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Excel 워크북 생성
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Inventory Report');
        
        // 헤더 추가
        const headerRow = worksheet.addRow(['날짜', '구분', '회사', '물품명', '수량', '뒷부호', '메이커', '창고', '위치', '메모', '담당자']);

        // 헤더 스타일 적용
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF87CEEB' }  // 하늘색 (SkyBlue)
            };
            cell.font = { bold: true };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FF000000' } },
                bottom: { style: 'thin', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FF000000' } }
            };
        });

        allData.forEach((item, index) => {
            const row = worksheet.addRow([
                item.date,
                item.type === 'inbound' ? '입고' : '출고',
                item.company,
                item.item_name,
                item.type === 'outbound' ? -item.total_quantity : item.total_quantity,
                item.item_subname,
                item.manufacturer,
                item.warehouse_name,
                item.warehouse_shelf,
                item.description,
                item.handler_name
            ]);

            if (item.type === 'outbound') {
                row.font = { color: { argb: 'FFFF0000' } };
            }

            row.eachCell((cell) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } }
                };
            });
        });

        worksheet.columns.forEach(column => {
            column.width = 15;
        });
        
        const now = new Date();
        const filename = `inventory_report_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}.xlsx`;
        const encodedFilename = encodeURIComponent(filename);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).json({ error: 'Excel 파일 생성 중 오류가 발생했습니다.' });
    }
});

router.get('/export-inventory-summary', async (req, res) => {
    try {
        // 재고 현황 조회
        const inventory = await db.all(`
            SELECT 
                i.id,
                i.manufacturer,
                i.item_name,
                i.item_subname,
                i.item_subno,
                ci.warehouse_name,
                ci.warehouse_shelf,
                ci.current_quantity
            FROM 
                items i
            INNER JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                ci.current_quantity > 0
            ORDER BY
                i.item_name,
                i.item_subname,
                i.manufacturer, 
                ci.warehouse_name,
                ci.warehouse_shelf
        `);

        // 엑셀 워크북 생성
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('재고 현황');

        // 헤더 설정
        const headers = ['물품명', '뒷부호', '추가번호', '메이커', '창고', '위치', '수량'];
        const headerRow = worksheet.addRow(headers);

        // 헤더 스타일 설정
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }  // 연한 회색
            };
            cell.font = { bold: true };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // 데이터 그룹화 및 소계/총계 계산
        let currentItemName = '';
        let subtotal = 0;
        let grandTotal = 0;

        inventory.forEach((item) => {
            // 새로운 물품명 그룹 시작 시 이전 그룹의 소계 추가
            if (currentItemName && currentItemName !== item.item_name && subtotal > 0) {
                // 소계 행 추가
                const subtotalRow = worksheet.addRow([
                    `${currentItemName} 소계:`, '', '', '', '', '',
                    subtotal
                ]);
                
                // 소계 행 스타일 설정
                subtotalRow.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF5F5F5' }  // 매우 연한 회색
                    };
                    cell.font = { bold: true };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' }
                    };
                });
                subtotalRow.getCell(7).alignment = { horizontal: 'right' };
                
                subtotal = 0;
            }

            // 일반 데이터 행 추가
            const row = worksheet.addRow([
                item.item_name,
                item.item_subname,
                item.item_subno,
                item.manufacturer,
                item.warehouse_name,
                item.warehouse_shelf,
                item.current_quantity
            ]);

            // 데이터 행 스타일 설정
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            row.getCell(7).alignment = { horizontal: 'right' };  // 수량 우측 정렬

            // 소계 및 총계 계산
            subtotal += item.current_quantity;
            grandTotal += item.current_quantity;
            currentItemName = item.item_name;
        });

        // 마지막 그룹의 소계 추가
        if (subtotal > 0) {
            const lastSubtotalRow = worksheet.addRow([
                `${currentItemName} 소계:`, '', '', '', '', '',
                subtotal
            ]);
            lastSubtotalRow.eachCell((cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF5F5F5' }
                };
                cell.font = { bold: true };
                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' }
                };
            });
            lastSubtotalRow.getCell(7).alignment = { horizontal: 'right' };
        }

        // 총계 행 추가
        const totalRow = worksheet.addRow([
            '총계:', '', '', '', '', '',
            grandTotal
        ]);
        
        // 총계 행 스타일 설정
        totalRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            cell.font = { bold: true };
            cell.border = {
                top: { style: 'double' },
                bottom: { style: 'double' }
            };
        });
        totalRow.getCell(7).alignment = { horizontal: 'right' };

        // 컬럼 너비 자동 조정
        worksheet.columns.forEach((column, index) => {
            let maxLength = 0;
            column.eachCell({ includeEmpty: true }, (cell) => {
                const length = cell.value ? cell.value.toString().length : 10;
                if (length > maxLength) {
                    maxLength = length;
                }
            });
            column.width = maxLength < 10 ? 10 : maxLength + 2;
        });

        // 파일 이름 설정 및 다운로드
        const now = new Date();
        const filename = `inventory_summary_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}.xlsx`;
        const encodedFilename = encodeURIComponent(filename);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).json({ error: '재고 현황 Excel 파일 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT license. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Component, Event, EventEmitter, Listen, Prop, State, Watch } from '@stencil/core';
import { Column } from './grid-helpers';
import { renderRow, RowOptions, RowSelectionPattern } from './row';
import { renderHeaderCell, Sort } from './header-cell';

@Component({
  tag: 'sui-grid',
  styleUrl: './grid.css'
})
export class SuiGrid {
  /**
   * Grid data
   */
  @Prop() cells: string[][];

  /**
   * Column definitions
   */
  @Prop() columns: Column[];

  /**
   * Caption/description for the grid
   */
  @Prop() description: string;

  /**
   * Grid type: grids have controlled focus and fancy behavior, tables are simple static content
   */
  @Prop() gridType: 'grid' | 'table';

  /**
   * String ID of labelling element
   */
  @Prop() labelledBy: string;

  /**
   * Number of rows in one "page": used to compute pageUp/pageDown key behavior, and when paging is used
   */
  @Prop() pageLength = 30;

  /**
   * Custom function to control the render of cell content
   */
  @Prop() renderCustomCell: (content: string, colIndex: number, rowIndex: number) => string | HTMLElement;

  /**
   * Index of the column that best labels a row
   */
  @Prop() titleColumn = 0;

  /** Properties for Usability test case behaviors: **/
  @Prop() editable: boolean = true;
  @Prop() editOnClick: boolean;
  @Prop() headerActionsMenu: boolean;
  @Prop() rowSelection: RowSelectionPattern;
  @Prop() simpleEditable = false;
  @Prop() useApplicationRole = false;

  /**
   * Emit a custom filter event
   */
  @Event({
    eventName: 'filter'
  }) filterEvent: EventEmitter;

  /**
   * Emit a custom row selection event
   */
  @Event({
    eventName: 'rowSelect'
  }) rowSelectionEvent: EventEmitter;

  /**
   * Emit a custom edit event when cell content change is submitted
   */
  @Event({
    eventName: 'editCell'
  }) editCellEvent: EventEmitter<{value: string; column: number; row: number;}>;

  /**
   * Save number of selected rows
   */
  @State() selectedRowCount = 0;

  /**
   * Save column sort state
   */
  @State() sortedColumn: number;
  @State() sortState: Sort;

  // save cell focus and edit states
  // active cell refers to the [column, row] indices of the cell
  @State() activeCell: [number, number] = [0, 0];
  @State() isEditing = false;

  /**
   * Save current filter strings
   */
  private filters: WeakMap<Column, string> = new WeakMap();

  /**
   * Save selection state by row
   */
  private selectedRows: WeakMap<string[], boolean> = new WeakMap();

  /**
   * Save current sorted cell array
   * Will likely need to be moved out of component to allow on-demand and paged grids
   */
  private sortedCells: string[][];

  /*
   * DOM Refs:
   */
  // Save a reference to whatever element should receive focus
  private focusRef: HTMLElement;

  /*
   * Private properties used to trigger DOM methods in the correct lifecycle callback
   */
  private callFocus = false;
  private callInputSelection = false;
  private preventSave = false; // prevent saves on escape
  private mouseDown = false; // handle focus/click behavior

  @Watch('cells')
  watchOptions(newValue: string[][]) {
    this.sortedCells = this.getSortedCells(newValue);

    // reset selectedRowCount
    let selectedRowCount = 0;
    newValue.forEach((row: string[]) => {
      this.selectedRows.has(row) && selectedRowCount++;
    });
    this.selectedRowCount = selectedRowCount;
  }

  componentWillLoad() {
    this.sortedCells = this.cells;
  }

  componentDidUpdate() {
    // handle focus
    this.callFocus && this.focusRef && this.focusRef.focus();
    this.callFocus = false;

    // handle input text selection
    this.callInputSelection && this.focusRef && (this.focusRef as HTMLInputElement).select();
    this.callInputSelection = false;
  }

  @Listen('focusout')
  onBlur(event: FocusEvent) {
    if (this.isEditing && event.relatedTarget && event.relatedTarget !== this.focusRef && !this.simpleEditable) {
      this.updateEditing(false, false);
    }
  }

  render() {
    const {
      columns = [],
      description,
      editable,
      gridType = 'table',
      headerActionsMenu,
      rowSelection,
      selectedRows,
      sortedCells = [],
      sortedColumn,
      sortState,
      useApplicationRole
    } = this;
    const rowSelectionState = this.getSelectionState();
    const tableRole = useApplicationRole ? 'application' : gridType;

    return <table role={tableRole} aria-roledescription={useApplicationRole ? 'editable data grid' : null} class="grid" aria-labelledby={this.labelledBy} aria-readonly={editable ? null : 'true'}>
      {description ? <caption>{description}</caption> : null}
      <thead role="rowgroup" class="grid-header">
        <tr role="row" class="row">
          {rowSelection !== RowSelectionPattern.None ?
            <th role="columnheader" aria-labelledby="select-all-header" class={{'checkbox-cell': true, 'indeterminate': rowSelectionState === 'indeterminate'}}>
              <span class="visuallyHidden" id="select-all-header">select row</span>
              <input
                type="checkbox"
                aria-label="select all rows"
                checked={!!rowSelectionState}
                ref={(el) => {
                  if (rowSelectionState === 'indeterminate') {
                    el.indeterminate = true;
                  }
                }}
                onChange={(event) => this.onSelectAll((event.target as HTMLInputElement).checked)} />
              <span class="selection-indicator"></span>
            </th>
          : null}
          {columns.map((column, index) => {
            return renderHeaderCell({
              column,
              colIndex: index,
              actionsMenu: headerActionsMenu,
              isSortedColumn: sortedColumn === index,
              sortDirection: sortState,
              onSort: this.onSortColumn.bind(this),
              onFilter: this.onFilterInput.bind(this)
            });
          })}
        </tr>
      </thead>
      <tbody role="rowgroup" class="grid-body" onKeyDown={this.onCellKeydown.bind(this)}>
        {sortedCells.map((cells = [], index) => {
          const isSelected = !!selectedRows.get(cells);
          let rowOptions: RowOptions = {
            cells,
            index,
            isSelected,
            selection: rowSelection,
            renderCell: this.renderCell.bind(this),
            renderCheckboxCell: this.renderCheckboxCell.bind(this),
            onSelectionChange: this.onRowSelect.bind(this)
          };

          if (this.rowSelection === RowSelectionPattern.Aria) {
            const isActiveRow = this.activeCell[1] === index;
            rowOptions = {
              ...rowOptions,
              isActiveRow,
              setFocusRef: (el) => this.focusRef = el,
              onRowKeyDown: this.onRowKeyDown.bind(this)
            }
          }
          return renderRow(rowOptions);
        })}
      </tbody>
    </table>;
  }

  private getSelectionState(): boolean | 'indeterminate' {
    return this.selectedRowCount === 0 ? false : this.selectedRowCount === this.cells.length ? true : 'indeterminate';
  }

  private getSortedCells(cells: string[][]) {
    if (this.sortedColumn !== undefined && this.sortState !== Sort.None) {
      return [ ...cells ].sort(this.getSortFunction(this.sortedColumn, this.sortState));
    }

    return cells;
  }

  private getSortFunction(columnIndex: number, order: Sort) {
    return function(row1, row2) {
      const a = row1[columnIndex].toLowerCase();
      const b = row2[columnIndex].toLowerCase();
      if (a < b) {
        return order === Sort.Ascending ? -1 : 1;
      }
      else if (a > b) {
        return order === Sort.Ascending ? 1 : -1;
      }
      else {
        return 0;
      }
    }
  }

  private onCellClick(row, column) {
    if (this.simpleEditable) return;
    // always edit on click if clicking the active cell
    if (this.editOnClick || (this.activeCell[0] === column && this.activeCell[1] === row)) {
      this.updateEditing(true, true);
    }

    this.activeCell = [column, row];
  }

  private onCellDoubleClick(event) {
    if (!this.editOnClick && !this.simpleEditable) {
      this.updateEditing(true, true);
      event.preventDefault();
    }
  }

  private onCellFocus(row, column) {
    if (this.mouseDown) {
      this.mouseDown = false;
      return;
    }

    this.activeCell = [column, row];
  }

  private onCellKeydown(event: KeyboardEvent) {
    const { pageLength } = this;
    const maxCellIndex = this.rowSelection === RowSelectionPattern.Checkbox ? this.columns.length : this.columns.length - 1;
    let [colIndex, rowIndex] = this.activeCell;
    switch(event.key) {
      case 'ArrowUp':
        rowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'ArrowDown':
        rowIndex = Math.min(this.cells.length - 1, rowIndex + 1);
        break;
      case 'ArrowLeft':
        colIndex = Math.max(0, colIndex - 1);
        break;
      case 'ArrowRight':
        colIndex = Math.min(maxCellIndex, colIndex + 1);
        break;
      case 'Home':
        colIndex = 0;
        break;
      case 'End':
        colIndex = maxCellIndex;
        break;
      case 'Enter':
      case ' ':
        if (this.simpleEditable) return;
        event.preventDefault();
        this.updateEditing(true, true);
        break;
      case 'PageUp':
        rowIndex = Math.max(0, rowIndex - pageLength);
        break;
      case 'PageDown':
        rowIndex = Math.min(this.cells.length - 1, rowIndex + pageLength);
        break;
    }

    if (this.updateActiveCell(colIndex, rowIndex)) {
      event.preventDefault();
    }
  }

  private onEditButtonClick(event: MouseEvent, row: number, column: number, edit: boolean, save = false) {
    event.stopPropagation();
    this.activeCell = [column, row];
    this.updateEditing(edit, true);
    if (save) {
      this.saveCell(column, row, (this.focusRef as HTMLInputElement).value);
    }
  }

  private onFilterInput(value: string, column: Column) {
    this.filters.set(column, value);

    const filters = {};
    this.columns.forEach((column, index) => {
      if (column.filterable && this.filters.has(column)) {
        const filterString = this.filters.get(column);
        if (filterString.trim() !== '') {
          filters[index] = filterString;
        }
      }
    });

    this.filterEvent.emit(filters);
  }

  private onInputBlur(event: FocusEvent) {
    if (!this.simpleEditable) {
      const cellIndex = this.rowSelection === RowSelectionPattern.Checkbox ? this.activeCell[0] - 1 : this.activeCell[0];
      this.saveCell(cellIndex, this.activeCell[1], (event.target as HTMLInputElement).value);
    }
  }

  private onInputKeyDown(event: KeyboardEvent) {
    // allow input to handle its own keystrokes
    event.stopPropagation();

    const { key, shiftKey } = event;

    if (key === 'Escape') {
      this.preventSave = true;
    }

    // switch out of edit mode on enter or escape
    if (key === 'Escape' || key === 'Enter') {
      this.updateEditing(false, true);
    }

    // save value on enter
    if (key === 'Enter') {
      const cellIndex = this.rowSelection === RowSelectionPattern.Checkbox ? this.activeCell[0] - 1 : this.activeCell[0];
      this.saveCell(cellIndex, this.activeCell[1], (event.target as HTMLInputElement).value);
    }

    // allow tab and shift+tab to move through cells in a row for edit on click grid
    else if (key === 'Tab' && this.editOnClick) {
      const maxCellIndex = this.rowSelection === RowSelectionPattern.Checkbox ? this.columns.length : this.columns.length - 1;
      if (shiftKey && this.activeCell[0] > 0) {
        this.saveCell(this.activeCell[0], this.activeCell[1], (event.target as HTMLInputElement).value);
        this.updateActiveCell(this.activeCell[0] - 1, this.activeCell[1]);
        this.preventSave = true;
        event.preventDefault();
      }
      else if (!shiftKey && this.activeCell[0] < maxCellIndex) {
        this.saveCell(this.activeCell[0], this.activeCell[1], (event.target as HTMLInputElement).value);
        this.updateActiveCell(this.activeCell[0] + 1, this.activeCell[1]);
        this.preventSave = true;
        event.preventDefault();
      }
    }
  }

  private onRowKeyDown(event: KeyboardEvent) {
    const { pageLength } = this;
    let [colIndex, rowIndex] = this.activeCell;
    switch(event.key) {
      case 'ArrowUp':
        rowIndex = Math.max(0, rowIndex - 1);
        break;
      case 'ArrowDown':
        rowIndex = Math.min(this.cells.length - 1, rowIndex + 1);
        break;
      case 'PageUp':
        rowIndex = Math.max(0, rowIndex - pageLength);
        break;
      case 'PageDown':
        rowIndex = Math.min(this.cells.length - 1, rowIndex + pageLength);
        break;
    }

    if (this.updateActiveCell(colIndex, rowIndex)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private onRowSelect(row: string[], selected: boolean) {
    this.selectedRows.set(row, selected);
    this.selectedRowCount = this.selectedRowCount + (selected ? 1 : -1);
  }

  private onSelectAll(selected: boolean) {
    this.cells.forEach((row) => {
      this.selectedRows.set(row, selected);
    });
    this.selectedRowCount = selected ? this.cells.length : 0;
  }

  private onSortColumn(columnIndex: number) {
    if (columnIndex === this.sortedColumn) {
      this.sortState = this.sortState === Sort.Descending ? Sort.Ascending : Sort.Descending;
    }
    else {
      this.sortedColumn = columnIndex;
      this.sortState = Sort.Ascending;
    }

    this.sortedCells = this.getSortedCells(this.cells);
  }

  private renderCell(rowIndex: number, cellIndex: number, content: string) {
    const activeCellId = this.activeCell.join('-');
    const currentCellKey = `${cellIndex}-${rowIndex}`;
    const cellColumn = this.rowSelection === RowSelectionPattern.Checkbox ? this.columns[cellIndex - 1] : this.columns[cellIndex];
    const isActiveCell = activeCellId === currentCellKey && !cellColumn.actionsColumn;
    const isGrid = this.gridType === 'grid';
    return <td
      role={isGrid ? 'gridcell' : 'cell'}
      id={`cell-${rowIndex}-${cellIndex}`}
      class={{'cell': true, 'editing': this.isEditing && isActiveCell }}
      aria-label={this.useApplicationRole ? `${cellColumn.name} ${content}` : null}
      aria-readonly={!this.editable || cellColumn.actionsColumn ? 'true' : null}
      tabIndex={isGrid && this.rowSelection !== RowSelectionPattern.Aria ? isActiveCell ? 0 : -1 : null}
      ref={isActiveCell && !this.isEditing && this.rowSelection !== RowSelectionPattern.Aria ? (el) => { this.focusRef = el; } : null}
      onFocus={() => { this.onCellFocus(rowIndex, cellIndex)}}
      onClick={this.editable ? () => { this.onCellClick(rowIndex, cellIndex); } : null}
      onDblClick={this.editable ? this.onCellDoubleClick.bind(this) : null}
      onMouseDown={() => { this.mouseDown = true; }}
    >
      {this.isEditing && isActiveCell
        ? <input value={content} class="cell-edit" onKeyDown={this.onInputKeyDown.bind(this)} onBlur={this.onInputBlur.bind(this)} ref={(el) => this.focusRef = el} />
        : <span class="cell-content">{this.renderCellContent(content, cellIndex, rowIndex)}</span>
      }
      {this.simpleEditable && !cellColumn.actionsColumn ?
        this.isEditing && isActiveCell ?
          [
            <button class="grid-button" key={`${currentCellKey}-save`} type="button" onClick={(event) => { this.onEditButtonClick(event, rowIndex, cellIndex, false, true) }}><img src="/assets/ok.svg" alt="Save" role="img" /></button>,
            <button class="grid-button" key={`${currentCellKey}-cancel`} type="button" onClick={(event) => { this.onEditButtonClick(event, rowIndex, cellIndex, false) }}><img src="/assets/cancel.svg" alt="Cancel" role="img" /></button>
          ]
          : <button
              class="grid-button"
              key={`${currentCellKey}-edit`}
              type="button"
              ref={isActiveCell ? (el) => { this.focusRef = el; } : null}
              onClick={(event) => { this.onEditButtonClick(event, rowIndex, cellIndex, true) }}>
                <img src="/assets/edit.svg" alt="Edit" role="img" />
              </button>
        : null
      }
    </td>;
  }

  private renderCellContent(content: string, colIndex: number, rowIndex: number) {
    const { gridType, renderCustomCell = (content) => content } = this;
    const isActionsColumn = this.columns[colIndex] && this.columns[colIndex].actionsColumn;
    if (isActionsColumn) {
      const isActiveCell = this.activeCell.join('-') === `${colIndex}-${rowIndex}`;
      // spoof an action button
      return <button
        class="test-actions grid-button"
        id={`action-${rowIndex}-${colIndex}`}
        aria-labelledby={`action-${rowIndex}-${colIndex} cell-${rowIndex}-${this.titleColumn}`}
        tabIndex={gridType === 'grid' ? isActiveCell ? 0 : -1 : null}
        ref={isActiveCell && this.rowSelection !== RowSelectionPattern.Aria ? (el) => { this.focusRef = el; } : null}
        onClick={(() => alert(`This is just a test, you successfully activated the ${content} button`))}
        >
          {content}
        </button>;
    }
    else {
      return renderCustomCell(content, colIndex, rowIndex);
    }
  }

  private renderCheckboxCell(rowIndex: number, selected: boolean) {
    const activeCellId = this.activeCell.join('-');
    return <td role="gridcell" class="checkbox-cell">
      <input
        type="checkbox"
        checked={selected}
        aria-labelledby={`cell-${rowIndex}-${this.titleColumn + 1}`}
        tabIndex={activeCellId === `0-${rowIndex}` ? 0 : -1}
        ref={activeCellId === `0-${rowIndex}` ? (el) => { this.focusRef = el; } : null}
        onChange={(event) => this.onRowSelect(this.sortedCells[rowIndex], (event.target as HTMLInputElement).checked)}
        onKeyDown={(event) => { (event.key === ' ' || event.key === 'Enter') && event.stopPropagation(); }}
      />
      <span class="selection-indicator"></span>
    </td>;
  }

  private saveCell(column: number, row: number, value: string) {
    if (this.preventSave) {
      this.preventSave = false;
      return;
    }

    this.editCellEvent.emit({ column, row, value });
  }

  private updateActiveCell(colIndex, rowIndex): boolean {
    if (colIndex !== this.activeCell[0] || rowIndex !== this.activeCell[1]) {
      this.callFocus = true;
      this.activeCell = [colIndex, rowIndex];
      return true;
    }

    return false;
  }

  private updateEditing(editing: boolean, callFocus: boolean) {
    if (!this.editable && !this.simpleEditable) {
      return
    };

    this.isEditing = editing;
    this.callFocus = callFocus;
    this.callInputSelection = editing && callFocus;
  }
}
